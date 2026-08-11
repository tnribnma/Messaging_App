import json
from datetime import datetime
from typing import Dict, Any, Optional


class Message:
    def __init__(self, sender: str, text: str, timestamp: Optional[str] = None, reactions: Optional[Dict[str, int]] = None):
        self.sender = sender
        self.text = text
        self.timestamp = timestamp or datetime.now().isoformat()
        self.reactions = reactions or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sender": self.sender,
            "text": self.text,
            "timestamp": self.timestamp,
            "reactions": self.reactions
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    def to_bytes(self, encoding: str = "utf-8") -> bytes:
        return self.to_json().encode(encoding)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Message":
        return cls(
            sender=data.get("sender", "Unknown"),
            text=data.get("text", ""),
            timestamp=data.get("timestamp"),
            reactions=data.get("reactions", {})
        )

    @classmethod
    def from_json(cls, json_str: str) -> "Message":
        data = json.loads(json_str)
        return cls.from_dict(data)

    @classmethod
    def from_bytes(cls, data: bytes, encoding: str = "utf-8") -> "Message":
        return cls.from_json(data.decode(encoding))

    def format_display(self) -> str:
        try:
            ts = self.timestamp.split("T")[1][:5]
        except (IndexError, AttributeError):
            ts = "??:??"

        if self.sender == "[SYSTEM]":
            return f"[{ts}] >>> {self.text}"
        return f"[{ts}] {self.sender}: {self.text}"

    def is_system_message(self) -> bool:
        return self.sender == "[SYSTEM]"

    def is_join_message(self) -> bool:
        return self.text == ""

    @staticmethod
    def create_system_message(text: str) -> "Message":
        return Message(sender="[SYSTEM]", text=text)

    @staticmethod
    def create_join_message(username: str) -> "Message":
        return Message(sender=username, text="")

    def __str__(self) -> str:
        return self.format_display()

    def __repr__(self) -> str:
        return f"Message(sender={self.sender!r}, text={self.text!r})"