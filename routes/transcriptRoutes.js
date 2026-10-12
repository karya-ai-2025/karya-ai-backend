const express = require('express');
const { param, validationResult } = require('express-validator');
const { protect, restrictTo }     = require('../middleware/authMiddleware');
const ScheduledCall               = require('../models/ScheduledCall');
const CallTranscript              = require('../models/CallTranscript');
const { runTranscriptPipeline }   = require('../utils/transcriptPipeline');
const { extractProfileFromTranscript } = require('../utils/extractProfile');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Mapping extracted values onto BusinessProfile.
// Several profile fields are enums, and Claude returns free text — writing
// "B2B SaaS" straight into businessType would throw a ValidationError. These
// helpers normalise what they can and return null for anything unmappable,
// so an unrecognised value is skipped rather than blowing up the whole apply.
// ─────────────────────────────────────────────────────────────────────────────

const BUSINESS_TYPES = ['b2b', 'b2c', 'b2b2c', 'd2c', 'marketplace', 'saas', 'other'];

function normaliseBusinessType(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  if (v.includes('saas')) return 'saas';
  if (v.includes('b2b2c')) return 'b2b2c';
  if (v.includes('d2c') || v.includes('direct to consumer')) return 'd2c';
  if (v.includes('marketplace')) return 'marketplace';
  if (v.includes('b2b')) return 'b2b';
  if (v.includes('b2c')) return 'b2c';
  return BUSINESS_TYPES.includes(v) ? v : null;
}

/** "about 25 people" / "25" / "11-50" -> one of the companySize enum bands. */
function normaliseCompanySize(value) {
  if (!value) return null;
  const raw = String(value).toLowerCase().trim();
  const bands = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
  if (bands.includes(raw)) return raw;

  const nums = raw.match(/\d+/g);
  if (!nums) return null;
  const n = parseInt(nums[nums.length - 1], 10); // upper bound if a range
  if (Number.isNaN(n)) return null;

  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  return '1000+';
}

const asArray = (v) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
// Fields the user gave us themselves at registration (fullName, email, phone,
// company). These are authoritative — a model reading them off a call recording
// must never overwrite them, so re-extraction restores them from the database
// and the review form shows them read-only.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * register() defaults company.name to "<fullName>'s Company" when the user left
 * it blank, so the field is never empty. Treat that placeholder as "not given",
 * otherwise a real company name from the call could never fill it in.
 */
function isPlaceholderCompany(companyName, fullName) {
  if (!companyName) return true;
  if (!fullName) return false;
  return companyName.trim().toLowerCase() === `${fullName.trim().toLowerCase()}'s company`;
}

/** The user's current stored values — what the review form shows as existing. */
async function loadCurrentProfile(userId) {
  const User            = require('../models/User');
  const BusinessProfile = require('../models/BusinessProfile');

  const user = await User.findById(userId).select('fullName email phone').lean();
  if (!user) return null;

  const profile = await BusinessProfile.findOne({ user: userId })
    .select('company.name industry businessType companySize currentChallenges')
    .lean();

  const companyName = profile?.company?.name || null;

  return {
    fullName:    user.fullName || null,
    email:       user.email || null,
    phone:       user.phone || null,
    companyName,
    // Flagged so the UI can show "auto-generated at signup" rather than pretending
    // the user supplied it.
    companyIsPlaceholder: isPlaceholderCompany(companyName, user.fullName),
    industry:          profile?.industry || null,
    businessType:      profile?.businessType || null,
    companySize:       profile?.companySize || null,
    currentChallenges: profile?.currentChallenges || [],
    hasProfile:        !!profile,
  };
}

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transcripts/process/:callId
// Admin — manually trigger the transcript pipeline for a specific call
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/process/:callId',
  [protect, restrictTo('admin'), param('callId').isMongoId(), handleValidation],
  async (req, res) => {
    try {
      const result = await runTranscriptPipeline(req.params.callId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transcripts
// Admin — list all transcripts with optional status filter
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', [protect, restrictTo('admin')], async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = status ? { status } : {};

  const [transcripts, total] = await Promise.all([
    CallTranscript.find(filter)
      .populate('scheduledCallId', 'name email dateTime meetLink source')
      .populate('userId', 'fullName email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    CallTranscript.countDocuments(filter),
  ]);

  res.json({ success: true, total, page: Number(page), data: transcripts });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transcripts/:callId
// Admin — get transcript for a specific scheduled call
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:callId',
  [protect, restrictTo('admin'), param('callId').isMongoId(), handleValidation],
  async (req, res) => {
    const transcript = await CallTranscript.findOne({ scheduledCallId: req.params.callId })
      .populate('scheduledCallId', 'name email dateTime meetLink source')
      .populate('userId', 'fullName email role')
      .lean();

    if (!transcript)
      return res.status(404).json({ success: false, message: 'Transcript not found' });

    // Send what the user's profile already holds, so the form can show existing
    // values instead of blank boxes.
    const currentProfile = await loadCurrentProfile(transcript.userId?._id || transcript.userId);

    res.json({ success: true, data: transcript, currentProfile });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transcripts/:id/extract
// Admin — (re-)run Claude extraction against the transcript text already stored.
// This is what the "Extract" button calls. It does NOT re-fetch from Google Meet,
// so it works even after the pipeline has marked the call as processed.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/extract',
  [protect, restrictTo('admin'), param('id').isMongoId(), handleValidation],
  async (req, res) => {
    try {
      const transcript = await CallTranscript.findById(req.params.id)
        .populate('scheduledCallId', 'source');
      if (!transcript)
        return res.status(404).json({ success: false, message: 'Transcript not found' });

      if (!transcript.rawTranscript || !transcript.rawTranscript.trim()) {
        return res.status(400).json({
          success: false,
          message: 'This transcript has no text yet — nothing to extract from.',
        });
      }

      const userType = transcript.scheduledCallId?.source?.includes('expert')
        ? 'expert'
        : 'owner';

      const { extractedData, isMock } = await extractProfileFromTranscript({
        rawTranscript: transcript.rawTranscript,
        userType,
      });

      // The user told us their own name and company at registration. Whatever the
      // model heard on the call does not get to overwrite that, so restore those
      // fields from the database before saving the extraction.
      const currentProfile = await loadCurrentProfile(transcript.userId);
      if (currentProfile) {
        if (currentProfile.fullName) extractedData.name = currentProfile.fullName;
        // A signup placeholder is not a real answer — let the call fill that one in.
        if (currentProfile.companyName && !currentProfile.companyIsPlaceholder) {
          extractedData.companyName = currentProfile.companyName;
        }
      }

      // Recompute the combined flag rather than OR-ing onto the old one. OR-ing
      // meant a transcript marked mock before the API keys were configured could
      // never lose the badge, even once both steps had genuinely run for real.
      const meetIsMock = CallTranscript.inferMeetIsMock(transcript);

      const updated = await CallTranscript.findByIdAndUpdate(
        transcript._id,
        {
          extractedData,
          extractError: null,
          // Re-extracting supersedes any earlier review.
          status: 'extracted',
          meetIsMock,
          extractIsMock: isMock,
          isMock: meetIsMock || isMock,
        },
        { new: true }
      )
        // Re-populate the same refs the GET endpoints return, so the client can
        // merge this response without losing the caller/date shown in the header.
        .populate('scheduledCallId', 'name email dateTime meetLink source')
        .populate('userId', 'fullName email role');

      res.json({ success: true, isMock, data: updated, currentProfile });
    } catch (err) {
      await CallTranscript.findByIdAndUpdate(req.params.id, { extractError: err.message });
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/transcripts/:id/apply
// Admin — approve the extracted data and write it onto the user's profile.
//
// The admin reviews and edits the extraction in the UI first, so the edited
// object is sent in the request body and that is what gets applied. Falling
// back to the stored extraction keeps the endpoint usable on its own.
//
// Non-destructive by default: only fills fields that are currently empty.
// Send { overwrite: true } to replace existing profile values.
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id/apply',
  [protect, restrictTo('admin'), param('id').isMongoId(), handleValidation],
  async (req, res) => {
    try {
      const transcript = await CallTranscript.findById(req.params.id);
      if (!transcript)
        return res.status(404).json({ success: false, message: 'Transcript not found' });

      const data = req.body.extractedData || transcript.extractedData;
      if (!data)
        return res.status(400).json({ success: false, message: 'No extracted data to apply' });

      const overwrite = req.body.overwrite === true;
      const applied = { user: [], profile: [], skipped: [] };

      const User            = require('../models/User');
      const BusinessProfile = require('../models/BusinessProfile');

      // ── User document ──────────────────────────────────────────────────
      // Only fullName lives here. companyName/industry belong to
      // BusinessProfile — writing them to User silently does nothing.
      //
      // fullName came from the registration form, so it is left alone. It is
      // also `required`, so it is never empty and would always be skipped
      // anyway — overwrite is the only way to change it, and that is deliberate.
      const user = await User.findById(transcript.userId);
      if (user && data.name) {
        if (overwrite) {
          user.fullName = String(data.name).trim();
          await user.save({ validateModifiedOnly: true });
          applied.user.push('fullName');
        } else {
          applied.skipped.push('fullName (given at registration)');
        }
      }

      // ── Business profile ───────────────────────────────────────────────
      const profile = await BusinessProfile.findOne({ user: transcript.userId });

      if (!profile) {
        applied.skipped.push('business profile (user has none yet)');
      } else {
        const setIfEmpty = (path, value, current) => {
          if (!value) return;
          const isEmpty = Array.isArray(current) ? current.length === 0 : !current;
          if (!overwrite && !isEmpty) { applied.skipped.push(path); return; }
          profile.set(path, value);
          applied.profile.push(path);
        };

        // Company is special: registration auto-fills "<name>'s Company" when the
        // user leaves it blank, so that placeholder counts as empty and a real
        // name from the call is allowed to replace it.
        const existingCompany = profile.company?.name;
        const companyIsReal =
          existingCompany && !isPlaceholderCompany(existingCompany, user?.fullName);
        setIfEmpty(
          'company.name',
          data.companyName && String(data.companyName).trim(),
          companyIsReal ? existingCompany : null
        );
        setIfEmpty('industry', data.industry && String(data.industry).trim(), profile.industry);

        const bt = normaliseBusinessType(data.businessType);
        if (data.businessType && !bt) {
          applied.skipped.push(`businessType ("${data.businessType}" is not one of ${BUSINESS_TYPES.join('/')})`);
        } else {
          setIfEmpty('businessType', bt, profile.businessType);
        }

        const size = normaliseCompanySize(data.teamSize);
        if (data.teamSize && !size) {
          applied.skipped.push(`companySize (could not read a number from "${data.teamSize}")`);
        } else {
          setIfEmpty('companySize', size, profile.companySize);
        }

        // painPoints -> currentChallenges (free-text array, 200 char cap each)
        const challenges = asArray(data.painPoints).map((s) => s.slice(0, 200));
        setIfEmpty('currentChallenges', challenges.length ? challenges : null, profile.currentChallenges);

        // NOTE: goals are deliberately NOT written to marketingGoals — that field
        // is an enum of fixed values and free-text goals would fail validation.

        await profile.save({ validateModifiedOnly: true });
      }

      // Persist the admin's edited version so the record matches what was approved.
      transcript.extractedData   = data;
      transcript.appliedToProfile = true;
      transcript.reviewedByAdmin  = true;
      transcript.status           = 'applied';
      await transcript.save();

      res.json({
        success: true,
        message: 'Profile updated from transcript',
        applied,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
