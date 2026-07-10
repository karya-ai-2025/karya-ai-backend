/**
 * pdfFillService — read + fill PDF AcroForm fields with pdf-lib (pure JS, no
 * native/Chromium deps, Azure-safe).
 *
 *  - readFormFields(buffer) → the named form fields in a PDF (for the mapping UI).
 *  - fillPdf(buffer, values) → a personalized, FLATTENED PDF buffer.
 */

const { PDFDocument } = require('pdf-lib');

// A short, friendly type label for each pdf-lib field class.
const fieldType = (field) => {
  const cls = field.constructor?.name || '';
  if (cls.includes('TextField')) return 'text';
  if (cls.includes('CheckBox')) return 'checkbox';
  if (cls.includes('Dropdown')) return 'dropdown';
  if (cls.includes('OptionList')) return 'optionlist';
  if (cls.includes('RadioGroup')) return 'radio';
  return 'other';
};

// List the fillable form fields in a PDF. Returns [{ name, type }].
const readFormFields = async (pdfBuffer) => {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  return form.getFields().map((f) => ({ name: f.getName(), type: fieldType(f) }));
};

// Fill fields with values and flatten. `values` = { fieldName: 'value' }.
// Unknown/incompatible fields are skipped so one bad field can't fail the merge.
const fillPdf = async (pdfBuffer, values = {}) => {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  for (const field of form.getFields()) {
    const value = values[field.getName()];
    if (value === undefined || value === null) continue;
    try {
      if (typeof field.setText === 'function') {
        field.setText(String(value));                 // text fields
      } else if (typeof field.select === 'function' && String(value)) {
        field.select(String(value));                   // dropdown / option list
      } else if (typeof field.check === 'function') {
        const truthy = ['true', 'yes', '1', 'on', 'x'].includes(String(value).toLowerCase());
        truthy ? field.check() : field.uncheck?.();    // checkbox
      }
    } catch {
      /* skip a field that doesn't accept this value */
    }
  }

  try {
    form.flatten(); // bake the values into the page so recipients can't edit
  } catch {
    /* if flatten fails, still return the filled (un-flattened) PDF */
  }

  return Buffer.from(await pdfDoc.save());
};

module.exports = { readFormFields, fillPdf };
