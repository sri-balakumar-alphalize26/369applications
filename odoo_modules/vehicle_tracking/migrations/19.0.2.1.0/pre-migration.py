# -*- coding: utf-8 -*-
"""Re-run purpose sync to catch any vehicle.purpose rows added after the
first migration ran (19.0.2.0.0). Idempotent — skips names that already
match a visit.purpose row case-insensitively.

Why this exists: a user could have added new purposes via the legacy
Vehicle Tracking -> Purposes of Visit menu between the first upgrade and
now (the menu was still pointing at vehicle.purpose). After this version,
the menu is re-pointed at visit.purpose, but any vehicle.purpose rows
created in the interim still need to be copied across.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        INSERT INTO visit_purpose (name, active, create_date, write_date)
        SELECT vp.name, TRUE, NOW(), NOW()
          FROM vehicle_purpose vp
         WHERE vp.name IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM visit_purpose vsp
                WHERE LOWER(vsp.name) = LOWER(vp.name)
           )
    """)
    _logger.info(
        "[vehicle_tracking %s] purpose re-sync: inserted %s new visit.purpose rows",
        version, cr.rowcount,
    )
    # vehicle_tracking.purpose_of_visit_id FK already points at visit_purpose
    # (changed in 19.0.2.0.0). No re-point needed here.
