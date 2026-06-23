from odoo import models, fields, api


class VehicleLocation(models.Model):
    _name = 'vehicle.location'
    _description = 'Vehicle Location'

    name = fields.Char(string='Location Name', required=True)
    latitude = fields.Float(string='Latitude', required=True)
    longitude = fields.Float(string='Longitude', required=True)
    location = fields.Char(string='Location', required=True)

    # Coordinates captured from the mobile app (current-GPS source, map-picked
    # destination) are matched to ~5 decimal places (≈1 m) so the same spot
    # reuses one record instead of spawning near-duplicates on every trip.
    _COORD_PRECISION = 5

    @api.model
    def find_or_create_from_coords(self, name, latitude, longitude):
        """Return an existing vehicle.location at these coordinates, or create one.

        Used by vehicle.tracking when the app sends a free-typed / GPS-captured
        place (name + lat/long) instead of a pre-configured location id. Keeps
        source_id/destination_id as real records so distance estimate, GPS
        verification, trip-chaining and reports keep working — while letting the
        location list build itself.
        """
        try:
            lat = float(latitude)
            lng = float(longitude)
        except (TypeError, ValueError):
            return self.browse()

        name = (name or '').strip() or ('%.5f, %.5f' % (lat, lng))

        # Reuse an existing record at the same rounded coordinates.
        rounded_lat = round(lat, self._COORD_PRECISION)
        rounded_lng = round(lng, self._COORD_PRECISION)
        tol = 10 ** (-self._COORD_PRECISION) / 2.0
        existing = self.sudo().search([
            ('latitude', '>=', rounded_lat - tol),
            ('latitude', '<=', rounded_lat + tol),
            ('longitude', '>=', rounded_lng - tol),
            ('longitude', '<=', rounded_lng + tol),
        ], limit=1)
        if existing:
            return existing

        return self.sudo().create({
            'name': name,
            'latitude': lat,
            'longitude': lng,
            'location': name,
        })
