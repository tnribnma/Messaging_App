import asyncio
import json
from datetime import datetime

import websockets

clients = {}


def normalize_username(name):
    candidate = (name or "Anonymous").strip()
    if not candidate:
        return "Anonymous"
    return candidate[:20]


async def broadcast(message, exclude=None):
    if not clients:
        return

    payload = json.dumps(message)
    await asyncio.gather(
        *(
            websocket.send(payload)
            for websocket in clients
            if websocket is not exclude
        ),
        return_exceptions=True,
    )


async def send_user_list():
    users = sorted({username for username in clients.values() if username})
    await broadcast({
        "type": "user-list",
        "users": users,
        "timestamp": datetime.now().isoformat(),
    })


def get_websocket_for_user(target_name):
    for ws, user in clients.items():
        if user == target_name:
            return ws
    return None


async def handler(websocket):
    username = None
    try:
        raw_message = await websocket.recv()
        try:
            data = json.loads(raw_message)
        except json.JSONDecodeError:
            data = {"sender": "Anonymous", "type": "join"}

        username = normalize_username(data.get("sender"))
        clients[websocket] = username

        await send_user_list()
        await broadcast({
            "type": "system",
            "sender": "[SYSTEM]",
            "text": f"{username} joined the chat",
            "timestamp": datetime.now().isoformat(),
        }, exclude=websocket)

        async for raw_message in websocket:
            try:
                data = json.loads(raw_message)
            except json.JSONDecodeError:
                continue

            message_type = data.get("type", "chat")
            text = (data.get("text") or "").strip()

            if message_type == "join":
                continue

            if message_type == "typing":
                is_typing = bool(data.get("isTyping"))
                await broadcast({
                    "type": "typing",
                    "sender": username,
                    "isTyping": is_typing,
                    "timestamp": datetime.now().isoformat(),
                }, exclude=websocket)
                continue

            if message_type == "reaction":
                message_id = data.get("messageId")
                emoji = (data.get("emoji") or "").strip()
                if message_id and emoji:
                    await broadcast({
                        "type": "reaction",
                        "sender": username,
                        "messageId": message_id,
                        "emoji": emoji,
                        "timestamp": datetime.now().isoformat(),
                    })
                continue

            if message_type == "private_chat":
                recipient_name = normalize_username(data.get("recipient"))
                if recipient_name and recipient_name != username and text:
                    recipient_ws = get_websocket_for_user(recipient_name)
                    if recipient_ws is not None:
                        direct_message = {
                            "type": "private_chat",
                            "sender": username,
                            "recipient": recipient_name,
                            "text": text,
                            "replyTo": data.get("replyTo"),
                            "id": data.get("id") or f"{username}-{datetime.now().timestamp()}-{len(clients)}",
                            "timestamp": datetime.now().isoformat(),
                        }
                        await recipient_ws.send(json.dumps(direct_message))
                        await websocket.send(json.dumps(direct_message))
                continue

            if message_type == "chat" and text:
                payload = {
                    "type": "chat",
                    "sender": username,
                    "text": text,
                    "replyTo": data.get("replyTo"),
                    "id": data.get("id") or f"{username}-{datetime.now().timestamp()}-{len(clients)}",
                    "timestamp": datetime.now().isoformat(),
                }
                await broadcast(payload, exclude=websocket)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if websocket in clients:
            username = clients.pop(websocket, None)
            if username:
                await send_user_list()
                await broadcast({
                    "type": "system",
                    "sender": "[SYSTEM]",
                    "text": f"{username} left the chat",
                    "timestamp": datetime.now().isoformat(),
                })


async def main():
    print("  TimePass Server is running!")
    print("  WebSocket → ws://127.0.0.1:5555")
    async with websockets.serve(handler, "0.0.0.0", 5555):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())