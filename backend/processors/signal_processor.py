"""
Signal Processor: Evaluates cellular and wireless sensor node signal strength.
"""

from typing import Dict, Any, Optional
from ..core.constants import RSSI_EXCELLENT_DBM, RSSI_GOOD_DBM, RSSI_FAIR_DBM


class SignalProcessor:
    """Interprets dBm and CSQ values for 4G and wireless nodes."""

    @staticmethod
    def process_cellular_rssi(rssi_dbm: Optional[int]) -> Dict[str, Any]:
        """Classifies 4G cellular signal strength from dBm."""
        if rssi_dbm is None:
            return {
                "rssi_dbm": None,
                "csq": None,
                "quality": "UNKNOWN",
                "is_online": False,
                "label": "--"
            }

        # EC200U AT+CSQ approximation: dBm = -113 + (CSQ * 2) -> CSQ = (dBm + 113) / 2
        approx_csq = max(0, min(31, int((rssi_dbm + 113) / 2)))

        if rssi_dbm >= RSSI_EXCELLENT_DBM:
            quality = "EXCELLENT"
        elif rssi_dbm >= RSSI_GOOD_DBM:
            quality = "GOOD"
        elif rssi_dbm >= RSSI_FAIR_DBM:
            quality = "FAIR"
        else:
            quality = "POOR"

        return {
            "rssi_dbm": rssi_dbm,
            "csq": approx_csq,
            "quality": quality,
            "is_online": True,
            "label": f"{rssi_dbm} dBm (CSQ {approx_csq}/31)"
        }

    @staticmethod
    def process_node_rssi(node_rssi_dbm: Optional[int], node_connected: bool) -> Dict[str, Any]:
        """Classifies sensor node wireless signal strength."""
        if not node_connected or node_rssi_dbm is None:
            return {
                "rssi_dbm": None,
                "quality": "DISCONNECTED",
                "is_connected": False,
                "label": "Offline"
            }

        if node_rssi_dbm >= -60:
            quality = "EXCELLENT"
        elif node_rssi_dbm >= -75:
            quality = "GOOD"
        elif node_rssi_dbm >= -85:
            quality = "FAIR"
        else:
            quality = "WEAK"

        return {
            "rssi_dbm": node_rssi_dbm,
            "quality": quality,
            "is_connected": True,
            "label": f"{node_rssi_dbm} dBm ({quality})"
        }
