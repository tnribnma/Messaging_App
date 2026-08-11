import json
import struct
from message import Message
from config import ENCODING, BUFFER_SIZE

HEADER_FORMAT = "!I"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)


def encode_message(msg: Message) -> bytes:
    """
    Convert Message object → bytes with length prefix.
    Format: [4-byte length][JSON data]
    """
    payload = json.dumps(msg.to_dict()).encode(ENCODING)
    header = struct.pack(HEADER_FORMAT, len(payload))
    return header + payload


def decode_message(data: bytes) -> Message:
    """
    Convert received complete message bytes → Message object.
    Expects data WITHOUT the length header.
    """
    text = data.decode(ENCODING)
    payload = json.loads(text)
    return Message.from_dict(payload)


def encode_system(text: str) -> bytes:
    """Create a system message and encode it"""
    sys_msg = Message(sender="SYSTEM", text=text)
    return encode_message(sys_msg)


def send_message(sock, msg: Message):
    """Send a Message safely over the socket"""
    data = encode_message(msg)
    sock.sendall(data)


def recv_message(sock) -> Message | None:
    """
    Receive one complete message from the socket.
    Returns Message object or None if connection closed.
    """
    header = _recv_exact(sock, HEADER_SIZE)
    if header is None:
        return None

    msg_len = struct.unpack(HEADER_FORMAT, header)[0]

    if msg_len <= 0 or msg_len > BUFFER_SIZE * 4:
        raise ValueError(f"Invalid message length: {msg_len}")

    payload = _recv_exact(sock, msg_len)
    if payload is None:
        return None

    return decode_message(payload)


def _recv_exact(sock, size: int) -> bytes | None:
    """Receive exactly `size` bytes from the socket"""
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:          
            return None
        data += chunk
    return data