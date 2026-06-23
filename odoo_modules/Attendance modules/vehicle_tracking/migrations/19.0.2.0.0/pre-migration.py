# -*- coding: utf-8 -*-
"""Migrate vehicle.tracking.purpose_of_visit_id from vehicle.purpose to
visit.purpose.

Why pre-migration: Odoo's automatic schema sync (which runs after these
pre-migration scripts) will recreate the FK constraint on
vehicle_tracking.purpose_of_visit_id to point at visit_purpose instead of
vehicle_purpose. Existing values still point at vehicle_purpose IDs, so we
need to:

  1. Ensure a matching visit_purpose row exists for every vehicle_purpose name.
  2. Drop the old FK constraint (pointing at vehicle_purpose).
  3. Re-point each vehicle_tracking row's purpose_of_visit_id to the new id.

After this script, Odoo will create the FK pointing at visit_purpose and
all existing references will resolve cleanly.

Leaves the vehicle_purpose model/table installed (gracefully unused) so we
don't accidentally break any other module that referenced it.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    # 1. Insert visit.purpose rows for any vehicle.purpose names that don't
    #    already have a case-insensitive match.
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
        "[vehicle_tracking %s] inserted %s new visit.purpose rows from vehicle.purpose",
        version, cr.rowcount,
    )

    # 2. Drop the OLD foreign-key constraint pointing at vehicle_purpose so
    #    we can re-point the column without violating FK validation.
    #    Odoo names FK constraints as <table>_<column>_fkey.
    cr.execute("""
        ALTER TABLE vehicle_tracking
        DROP CONSTRAINT IF EXISTS vehicle_tracking_purpose_of_visit_id_fkey
    """)

    # 3. Re-point each non-null vehicle_tracking.purpose_of_visit_id from the
    #    old vehicle_purpose id to the matching visit_purpose id by name.
    cr.execute("""
        UPDATE vehicle_tracking vt
           SET purpose_of_visit_id = vsp.id
          FROM vehicle_purpose vp
          JOIN visit_purpose vsp ON LOWER(vsp.name) = LOWER(vp.name)
         WHERE vt.purpose_of_visit_id = vp.id
    """)
    _logger.info(
        "[vehicle_tracking %s] re-pointed %s vehicle_tracking.purpose_of_visit_id "
        "references from vehicle.purpose -> visit.purpose",
        version, cr.rowcount,
    )

    # Odoo's automatic schema sync will recreate the FK constraint pointing
    # at visit_purpose after this script completes.
