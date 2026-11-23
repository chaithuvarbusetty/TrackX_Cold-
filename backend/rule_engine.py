"""
Backward compatibility proxy for DeterministicRuleEngine.
Points to the modular backend.rules package.
"""

from .rules.rule_engine import DeterministicRuleEngine
from .rules.temperature_rules import TemperatureRules
from .rules.door_rules import DoorRules
from .rules.tamper_rules import TamperRules
from .rules.connectivity_rules import ConnectivityRules

__all__ = [
    "DeterministicRuleEngine",
    "TemperatureRules",
    "DoorRules",
    "TamperRules",
    "ConnectivityRules"
]
