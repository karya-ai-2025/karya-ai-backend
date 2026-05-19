const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['guide', 'case-study', 'template', 'playbook', 'video'],
      required: [true, 'Resource type is required'],
      default: 'guide',
    },
    typeLabel: { type: String, trim: true },
    emoji: { type: String, trim: true, default: '📖' },
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 200 },
    description: { type: String, required: [true, 'Description is required'], trim: true, maxlength: 1000 },
    image: { type: String, trim: true, default: null },   // optional cover image URL
    link: { type: String, required: [true, 'Link is required'], trim: true }, // "Read More" destination
    readTime: { type: String, trim: true, default: '5 min read' },
    badge: { type: String, trim: true, default: '' },
    badgeColor: { type: String, trim: true, default: 'bg-blue-600 text-white' },
    topics: [{ type: String, trim: true }],
    gradient: { type: String, trim: true, default: 'from-blue-500 to-cyan-600' },
    isPublished: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Auto-derive typeLabel from type if not provided
resourceSchema.pre('save', function () {
  if (!this.typeLabel) {
    const map = {
      'guide': 'Guide',
      'case-study': 'Case Study',
      'template': 'Template',
      'playbook': 'Playbook',
      'video': 'Video',
    };
    this.typeLabel = map[this.type] || 'Guide';
  }
});

resourceSchema.index({ isPublished: 1, createdAt: -1 });

module.exports = mongoose.model('Resource', resourceSchema);
