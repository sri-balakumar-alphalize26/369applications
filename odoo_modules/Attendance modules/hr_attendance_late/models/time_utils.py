def minutes_to_hm(total_minutes):
    """Convert minutes (int/float) to 'H:MM' format string.
    Examples:
        30  -> '0:30'
        60  -> '1:00'
        90  -> '1:30'
        145 -> '2:25'
        0   -> '0:00'
    """
    if not total_minutes or total_minutes <= 0:
        return '0:00'
    total_minutes = int(total_minutes)
    hours = total_minutes // 60
    mins = total_minutes % 60
    return f'{hours}:{mins:02d}'


def float_hours_to_hm(float_hours):
    """Convert float hours (e.g., 1.5) to 'H:MM' format string.
    Examples:
        1.5  -> '1:30'
        0.75 -> '0:45'
        8.0  -> '8:00'
    """
    if not float_hours or float_hours <= 0:
        return '0:00'
    total_minutes = int(round(float_hours * 60))
    hours = total_minutes // 60
    mins = total_minutes % 60
    return f'{hours}:{mins:02d}'
