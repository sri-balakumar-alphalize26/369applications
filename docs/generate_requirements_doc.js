const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} = require('docx');

const outputPath = path.join(__dirname, 'Client_Requirements_POS_Purchase_Sales.docx');

const title = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: true, size: 36 })],
    spacing: { after: 120 },
  });

const subtitle = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, italics: true, size: 24 })],
    spacing: { after: 240 },
  });

const meta = (text) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22 })],
  });

const heading = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 28 })],
    spacing: { before: 240, after: 120 },
  });

const body = (text) =>
  new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 120 },
  });

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 80 },
  });

const blank = () => new Paragraph({ children: [new TextRun('')] });

const children = [
  title('Application Requirements'),
  subtitle('Point of Sale, Purchase & Sales Modules'),

  meta('From: Client'),
  meta('To: Development Team'),
  meta('Date: 08 May 2026'),
  blank(),

  heading('Overview'),
  body(
    'We are using the mobile app for our day-to-day shop operations covering Point of Sale (POS), ' +
    'Purchase, and Sales. During recent use we noticed a few issues and also identified some ' +
    'improvements that will help our staff work faster and reduce errors on the floor. The points ' +
    'below explain what we need fixed or added in each module. Please go through them and confirm ' +
    'once these items are completed.'
  ),

  heading('Point of Sale (POS)'),
  bullet('Product category colours on the POS screen should always display correctly — currently they sometimes appear blank.'),
  bullet('Product category counts should always be visible on the POS screen.'),
  bullet('Products listed in POS should filter according to the selected database / warehouse so that staff only see relevant items.'),

  heading('Purchase'),
  bullet('Easy Purchase entries should be saved and synced to the system automatically — staff should not have to tap any extra buttons.'),
  bullet('Each Easy Purchase entry should show a temporary reference number on screen until the final Odoo number is assigned.'),
  bullet('After syncing, every Easy Purchase entry must map to the correct Odoo ID — no duplicates and no broken records.'),
  bullet('The Estimate Purchase product section should look and behave the same as the Easy Sales / Easy Purchase screen, so the team has a consistent experience.'),

  heading('Sales'),
  bullet('Easy Sales and the Sales Orders screen must remain reliably usable for staff at all times.'),
  bullet('Invoices for completed sales should be generated and synced automatically — staff should not need to tap a separate invoice button.'),
  bullet('Each sale should display a temporary reference number on the list view until the final Odoo number is assigned.'),
  bullet('The Sales Orders list should refresh automatically when data is updated, and a manual refresh option should also be available.'),
  bullet('Add a filter / section option to the Sales Orders list so we can quickly find specific orders.'),

  heading('Register Payment'),
  body('These points apply to payments made from POS, Purchase and Sales screens.'),
  bullet('Register Payment should remain reliably usable for staff, with automatic sync to the system.'),
  bullet('The signature pad should capture signatures cleanly without missing strokes (this had an issue earlier).'),
  bullet('Provide Paid, Cancel and Reset to Draft action buttons, along with filters to view payments by customer or vendor.'),
  bullet('Validation popups should not mention "Odoo" — please keep all messages client-facing and easy for our staff to read.'),

  heading('Closing'),
  body(
    'Kindly confirm once the above items are delivered. If you have any questions or need ' +
    'clarification on any point, please get in touch with us before starting the work.'
  ),
  blank(),
  body('Thank you,'),
  body('Client'),
];

const doc = new Document({
  creator: 'Client',
  title: 'Application Requirements - POS, Purchase & Sales',
  description: 'Client requirements brief for recent fixes and additions in the mobile app.',
  sections: [{ children }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outputPath, buf);
  console.log('Created:', outputPath, '(' + buf.length + ' bytes)');
});
