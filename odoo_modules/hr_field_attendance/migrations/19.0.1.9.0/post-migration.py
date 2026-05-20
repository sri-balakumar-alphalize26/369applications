# -*- coding: utf-8 -*-
"""Backfill field.attendance.trip.line.visit_id from the legacy visit_ids M2M.

The Add Additional Trip popup was converted from a multi-visit list to a
single-visit dropdown. Existing trip lines need their NEW visit_id field
populated from the first row of the legacy M2M relation so they keep
rendering correctly under the new UI.

The M2M relation table is field_attendance_trip_line_visit_rel with columns
line_id (FK to field_attendance_trip_line) and visit_id (FK to customer_visit) --
verified from the field declaration in field_attendance_trip_line.py.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        UPDATE field_attendance_trip_line tl
           SET visit_id = sub.first_visit_id
          FROM (
            SELECT line_id, MIN(visit_id) AS first_visit_id
              FROM field_attendance_trip_line_visit_rel
             GROUP BY line_id
          ) sub
         WHERE tl.id = sub.line_id
           AND tl.visit_id IS NULL
    """)
    _logger.info(
        "[hr_field_attendance %s] backfilled trip_line.visit_id "
        "from legacy visit_ids M2M (rowcount=%s)",
        version, cr.rowcount,
    )
