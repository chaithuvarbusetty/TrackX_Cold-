"""
Time and timestamp handling utilities for IoT telemetry.
"""

from datetime import datetime, timezone
from typing import Union, Optional


def utc_now() -> datetime:
    """Return the current timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def parse_timestamp(val: Union[str, datetime, None]) -> datetime:
    """Parses incoming string timestamp (from firmware or ISO) into timezone-aware UTC datetime object."""
    if not val:
        return utc_now()
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc)
    
    # Try common firmware formats
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ"
    ]
    for fmt in formats:
        try:
            parsed = datetime.strptime(str(val), fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
            
    # Fallback ISO parser
    try:
        parsed = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return utc_now()


def elapsed_seconds(from_time: datetime, to_time: Optional[datetime] = None) -> float:
    """Calculate elapsed seconds between two datetimes (handles naive and timezone-aware)."""
    if to_time is None:
        to_time = utc_now()
    
    # Normalize tzinfo if one is naive and other is aware
    if from_time.tzinfo is None and to_time.tzinfo is not None:
        from_time = from_time.replace(tzinfo=to_time.tzinfo)
    elif from_time.tzinfo is not None and to_time.tzinfo is None:
        to_time = to_time.replace(tzinfo=from_time.tzinfo)
        
    return abs((to_time - from_time).total_seconds())
