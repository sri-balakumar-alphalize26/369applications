from odoo import models, fields, api


class AttendanceHelpDocument(models.Model):
    _name = 'attendance.help.document'
    _description = 'Help / User Guide Document'
    _order = 'sequence, id'

    name = fields.Char(string='Title', required=True)
    description = fields.Char(string='Description')
    icon = fields.Char(string='Icon', default='📄',
                       help='Emoji or short label shown on the card.')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    # Optional rich HTML shown on "Open guide" instead of the embedded PDF.
    html_content = fields.Html(string='HTML Content', sanitize=False)
    # Module-relative path to a bundled HTML body file, e.g.
    # hr_attendance_late/static/src/docs/attendance_guide.html
    html_static_path = fields.Char(string='Static HTML Path')

    # Admin-uploaded PDF.
    pdf_file = fields.Binary(string='Upload PDF', attachment=True)
    pdf_filename = fields.Char(string='PDF Filename')
    # For bundled PDFs shipped in the module's static folder.
    pdf_static_path = fields.Char(
        string='Static PDF URL',
        help='For bundled PDFs, e.g. /hr_attendance_late/static/src/docs/x.pdf')

    pdf_url = fields.Char(string='PDF URL', compute='_compute_pdf_url')

    @api.depends('pdf_file', 'pdf_filename', 'pdf_static_path')
    def _compute_pdf_url(self):
        for rec in self:
            # Uploaded PDF wins over the bundled static path, so uploading a new
            # PDF actually changes what "Open in PDF doc" opens. Static path is
            # the fallback for shipped docs with no upload.
            if rec.pdf_file:
                rec.pdf_url = '/web/content/attendance.help.document/%s/pdf_file/%s?download=false' % (
                    rec.id, rec.pdf_filename or 'document.pdf')
            elif rec.pdf_static_path:
                rec.pdf_url = rec.pdf_static_path
            else:
                rec.pdf_url = False
