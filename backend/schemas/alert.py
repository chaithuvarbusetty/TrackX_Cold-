"""
Pydantic Schemas for Layer-1 Alerts and Notification Dispatching.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime


class RuleAlert(BaseModel):
    alert_id: str = Field(..., description="Unique alert instance ID")
    severity: Literal["INFO", "WARNING", "CRITICAL"] = Field(..., description="Urgency level")
    rule_name: str = Field(..., description="Code of the triggered rule")
    message: str = Field(..., description="Human-readable violation description")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ChannelConfigRequest(BaseModel):
    webhook_url: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    whatsapp_api_url: Optional[str] = None
    whatsapp_token: Optional[str] = None
    alert_min_severity: Optional[str] = None


class ChannelTestRequest(BaseModel):
    channel: str  # 'telegram', 'webhook', 'whatsapp'
    device_id: Optional[str] = "GW-001"
    webhook_url: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    whatsapp_api_url: Optional[str] = None
    whatsapp_token: Optional[str] = None
