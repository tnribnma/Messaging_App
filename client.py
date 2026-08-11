import asyncio
import json
import threading
from datetime import datetime

import websockets

from config import (
    ENCODING,
    CLIENT_DEFAULT_HOST,
    CLIENT_DEFAULT_PORT,
)

class Message:
    def __init__(self, sender: str, text: str, timestamp: str = None):
        self.sender = sender
        self.text = text
        self.timestamp = timestamp or datetime.now().isoformat()

    def to_dict(self) -> dict:
        return {
            "sender": self.sender,
            "text": self.text,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict):
        return cls(
            sender=data.get("sender", "Unknown"),
            text=data.get("text", ""),
            timestamp=data.get("timestamp"),
        )

    def format_display(self) -> str:
        try:
            ts = self.timestamp.split("T")[1][:5]
        except Exception:
            ts = "??:??"

        if self.sender == "[SYSTEM]":
            return f"[{ts}] >>> {self.text}"

        return f"[{ts}] {self.sender}: {self.text}"


class ChatClient:
    def __init__(self):
        self.websocket = None
        self.connected = False
        self.username = ""
        self.host = CLIENT_DEFAULT_HOST
        self.port = CLIENT_DEFAULT_PORT
        self.recv_thread = None

    def connect(self, host: str, port: int, username: str) -> bool:
        self.host = host
        self.port = port
        self.username = username

        self.connected = True

        self.recv_thread = threading.Thread(
            target=self._run_connection_loop,
            daemon=True,
        )

        self.recv_thread.start()

        return True

    def _run_connection_loop(self):
        asyncio.run(self._connection_loop())

    async def _connection_loop(self):
        uri = f"ws://{self.host}:{self.port}"

        try:
            async with websockets.connect(uri) as websocket:
                self.websocket = websocket
                self.connected = True

                join_msg = Message(
                    sender=self.username,
                    text="",
                )

                await websocket.send(
                    json.dumps(join_msg.to_dict())
                )

                async for raw in websocket:
                    try:
                        msg_dict = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    msg = Message.from_dict(msg_dict)

                    print(msg.format_display())

        except Exception as e:
            print(f"WebSocket connection error: {e}")

        finally:
            self.connected = False
            self.websocket = None

    def send(self, text: str) -> bool:
        if (
            not self.connected
            or self.websocket is None
            or not text.strip()
        ):
            return False

        try:
            msg = Message(
                sender=self.username,
                text=text.strip(),
            )

            asyncio.run(
                self._send_message(msg.to_dict())
            )

            return True

        except Exception as e:
            print(f"Send error: {e}")
            return False

    async def _send_message(self, payload: dict):
        if self.websocket is not None:
            await self.websocket.send(
                json.dumps(payload)
            )

    def disconnect(self):
        self.connected = False

        if self.websocket is not None:
            try:
                asyncio.run(
                    self.websocket.close()
                )
            except Exception:
                pass

            self.websocket = None

