import os
from odoo import http
from odoo.http import request
from odoo.modules.module import get_module_path


class AttendanceHelpController(http.Controller):

    def _read_module_file(self, path):
        """Read a bundled HTML body file given a 'module/relative/path' (guarded)."""
        if not path:
            return ''
        rel = path.lstrip('/')
        parts = rel.split('/', 1)
        if len(parts) != 2:
            return ''
        module, sub = parts
        base = get_module_path(module)
        if not base:
            return ''
        fpath = os.path.join(base, *sub.split('/'))
        try:
            if os.path.isfile(fpath):
                with open(fpath, 'r', encoding='utf-8') as f:
                    return f.read()
        except Exception:
            pass
        return ''

    @http.route('/attendance_help/guide/<int:doc_id>', type='http', auth='user')
    def help_guide(self, doc_id, **kw):
        """Render a help document as a styled HTML page. The PDF is NOT shown here —
        it only opens via the 'Open in PDF doc' button. Content priority:
        rich html_content → bundled html_static_path file → (last resort) embed PDF."""
        doc = request.env['attendance.help.document'].browse(doc_id).exists()
        if not doc:
            return request.not_found()

        pdf_url = doc.pdf_url or ''

        static_html = self._read_module_file(doc.html_static_path) if doc.html_static_path else ''
        if doc.html_content:
            body = ('<div style="max-width:980px;margin:0 auto;padding:24px;">'
                    + str(doc.html_content) + '</div>')
        elif static_html:
            body = ('<div style="max-width:980px;margin:0 auto;padding:24px;">'
                    + static_html + '</div>')
        elif pdf_url:
            body = ('<iframe src="' + pdf_url + '" title="PDF" '
                    'style="width:100%;height:calc(100vh - 54px);border:0;display:block;"></iframe>')
        else:
            body = '<p style="padding:24px;color:#666;">No content available for this guide yet.</p>'

        pdf_btn = ''
        if pdf_url:
            pdf_btn = ("<button onclick=\"window.open('" + pdf_url + "','_blank')\" "
                       "style=\"background:#fff;color:#2f3b8c;border:none;border-radius:6px;"
                       "padding:7px 14px;font-weight:600;cursor:pointer;\">&#128196; Open in PDF doc</button>")

        title = doc.name or 'Guide'
        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>'
            '<title>' + title + '</title></head>'
            '<body style="margin:0;font-family:\'Segoe UI\',Arial,sans-serif;color:#222;">'
            '<div style="position:sticky;top:0;z-index:5;background:#2f3b8c;color:#fff;'
            'padding:11px 18px;display:flex;align-items:center;justify-content:space-between;">'
            '<span style="font-weight:bold;font-size:16px;">' + title + '</span>'
            + pdf_btn + '</div>'
            + body +
            '</body></html>'
        )
        return request.make_response(
            html, headers=[('Content-Type', 'text/html; charset=utf-8')])
