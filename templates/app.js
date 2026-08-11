const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const clearBtn = document.getElementById("clear-btn");
const emojiBtn = document.getElementById("emoji-btn");
const emojiPicker = document.getElementById("emoji-picker");
const joinModal = document.getElementById("join-modal");
const nameInput = document.getElementById("name-input");
const joinBtn = document.getElementById("join-btn");
const usernameEl = document.getElementById("username");
const avatarEl = document.getElementById("avatar");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const userList = document.getElementById("user-list");
const onlineCountEl = document.getElementById("online-count");
const typingStatusEl = document.getElementById("typing-status");
const chatTitle = document.getElementById("chat-title");
const chatSubtitle = document.getElementById("chat-subtitle");
const contactAvatar = document.getElementById("contact-avatar");
const searchInput = document.getElementById("conversation-search");
const themeToggle = document.getElementById("theme-toggle");
const replyPreview = document.getElementById("reply-preview");
const reactionPopover = document.getElementById("reaction-popover");

let myName = "";
let socket = null;
let typingTimer = null;
let currentChat = "general";
let latestOnlineUsers = [];
let currentSearchQuery = "";
let replyTarget = null;
let popoverTargetId = null;
let touchTimer = null;
let touchTarget = null;

const typingUsers = new Map();
const conversationStore = { general: [] };
const unreadByThread = new Map();

const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;
const LONG_PRESS_MS = 500;

const savedTheme = localStorage.getItem("timepass-theme") || "dark";
document.body.dataset.theme = savedTheme;
updateThemeButton(savedTheme);

themeToggle.addEventListener("click", () => {
    const activeTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = activeTheme;
    localStorage.setItem("timepass-theme", activeTheme);
    updateThemeButton(activeTheme);
});

function updateThemeButton(theme) {
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
}

joinBtn.addEventListener("click", joinChat);
nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinChat();
});

searchInput.addEventListener("input", () => {
    currentSearchQuery = searchInput.value.trim().toLowerCase();
    const items = userList.querySelectorAll(".online-user");
    items.forEach((item) => {
        const user = (item.dataset.user || "").toLowerCase();
        item.style.display =
            !currentSearchQuery || user.includes(currentSearchQuery) ? "" : "none";
    });
    renderMessages();
});

messageInput.addEventListener("input", () => {
    const filled = messageInput.value.trim().length > 0;
    sendBtn.disabled = !filled || !socket || socket.readyState !== WebSocket.OPEN;
    updateTypingState();
});

messageInput.addEventListener("blur", () => updateTypingState(false));

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
});

emojiBtn.addEventListener("click", () => {
    if (!emojiPicker) return;
    emojiPicker.hidden = !emojiPicker.hidden;
    if (!emojiPicker.hidden) messageInput.focus();
});

emojiPicker.addEventListener("click", (event) => {
    const emojiButton = event.target.closest(".emoji-option");
    if (!emojiButton) return;
    const imagePath = emojiButton.dataset.imagePath;
    if (!imagePath) return;

    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? messageInput.value.length;
    messageInput.value =
        messageInput.value.slice(0, start) +
        imagePath +
        messageInput.value.slice(end);
    const cursor = start + imagePath.length;
    messageInput.focus();
    messageInput.setSelectionRange(cursor, cursor);
    emojiPicker.hidden = true;
    messageInput.dispatchEvent(new Event("input", { bubbles: true }));
});

userList.addEventListener("click", (event) => {
    const target = event.target.closest(".online-user");
    if (!target) return;
    const selectedUser = target.dataset.user;
    if (!selectedUser || selectedUser === myName) setActiveRoom("general");
    else setActiveRoom(selectedUser);
    renderMessages();
});

messagesDiv.addEventListener("click", (event) => {
    const reactionButton = event.target.closest(".message-reaction");
    if (reactionButton) {
        const key = reactionButton.dataset.emoji || "images/like.png";
        const id = reactionButton.dataset.messageId;
        if (id) sendReaction(id, key);
        return;
    }

    const messageNode = event.target.closest(".message");
    if (!messageNode || !messageNode.dataset.messageId) return;

    const activeThread =
        currentChat === "general"
            ? "general"
            : getPrivateThreadKey(myName, currentChat);
    const threadMessages = conversationStore[activeThread] || [];
    const target = threadMessages.find(
        (m) => m.id === messageNode.dataset.messageId
    );
    if (!target) return;

    replyTarget = { id: target.id, sender: target.sender, text: target.text };
    updateReplyPreview();
    messageInput.focus();
});

messagesDiv.addEventListener("contextmenu", (event) => {
    const messageNode = event.target.closest(".message");
    if (!messageNode || !messageNode.dataset.messageId) return;
    showReactionPopover(messageNode, event);
});

messagesDiv.addEventListener("touchstart", (event) => {
    const messageNode = event.target.closest(".message");
    if (!messageNode || !messageNode.dataset.messageId) return;
    touchTarget = messageNode;
    touchTimer = setTimeout(() => {
        if (touchTarget) showReactionPopover(touchTarget);
        touchTarget = null;
    }, LONG_PRESS_MS);
}, { passive: true });

messagesDiv.addEventListener("touchend", () => {
    if (touchTimer) clearTimeout(touchTimer);
    touchTarget = null;
});

messagesDiv.addEventListener("touchmove", () => {
    if (touchTimer) clearTimeout(touchTimer);
    touchTarget = null;
});

reactionPopover?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-emoji]");
    if (!button || !popoverTargetId) return;
    sendReaction(popoverTargetId, button.dataset.emoji);
    hideReactionPopover();
});

document.addEventListener("click", (event) => {
    if (!reactionPopover || !reactionPopover.classList.contains("visible")) return;
    if (reactionPopover.contains(event.target)) return;
    if (event.target.closest(".message")) return;
    hideReactionPopover();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideReactionPopover();
});

messagesDiv.addEventListener("scroll", hideReactionPopover);
window.addEventListener("resize", hideReactionPopover);
window.addEventListener("blur", hideReactionPopover);

function hideReactionPopover() {
    if (!reactionPopover) return;
    reactionPopover.classList.remove("visible");
    popoverTargetId = null;
}

function showReactionPopover(messageEl, event) {
    if (!reactionPopover || !messageEl) return;
    popoverTargetId = messageEl.dataset.messageId;
    if (!popoverTargetId) return;

    const rect = messageEl.getBoundingClientRect();
    const popWidth = 220;
    reactionPopover.classList.add("visible");

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let top = scrollY + rect.top - 52;
    let left = scrollX + rect.left + rect.width / 2 - popWidth / 2;

    const maxLeft = scrollX + window.innerWidth - popWidth - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < scrollX + 8) left = scrollX + 8;
    if (top < scrollY + 8) top = scrollY + rect.bottom + 8;

    reactionPopover.style.top = `${top}px`;
    reactionPopover.style.left = `${left}px`;

    event?.preventDefault?.();
}

clearBtn.addEventListener("click", () => {
    messagesDiv.innerHTML = "";
    addSystemMessage("Chat cleared. New messages will appear here.");
});

function joinChat() {
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.focus();
        return;
    }
    myName = name;
    usernameEl.textContent = name;
    avatarEl.textContent = name.charAt(0).toUpperCase();
    contactAvatar.textContent = "G";
    setConnectionState(true);
    currentChat = "general";

    messageInput.disabled = false;
    sendBtn.disabled = true;
    joinModal.style.display = "none";
    messageInput.focus();

    connectToServer();
    renderMessages();
}

function connectToServer() {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    socket = new WebSocket("ws://127.0.0.1:5555");

    socket.onopen = () => {
        socket.send(JSON.stringify({
            type: "join",
            sender: myName,
            text: "",
            timestamp: new Date().toISOString()
        }));
    };

    socket.onmessage = (event) => {
        try { handleIncomingMessage(JSON.parse(event.data)); }
        catch { addSystemMessage("Received an invalid server message."); }
    };

    socket.onclose = () => {
        setConnectionState(false);
        messageInput.disabled = true;
        sendBtn.disabled = true;
        addSystemMessage("Disconnected from server");
    };

    socket.onerror = () => addSystemMessage("Connection error. Please try again.");
}

function sendReaction(messageId, key) {
    if (!messageId || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: "reaction",
        sender: myName,
        messageId,
        emoji: key,
        timestamp: new Date().toISOString()
    }));
    applyReaction({ messageId, emoji: key });
}

function updateReplyPreview() {
    if (!replyPreview) return;
    if (!replyTarget) {
        replyPreview.hidden = true;
        replyPreview.innerHTML = "";
        return;
    }
    replyPreview.hidden = false;
    replyPreview.innerHTML =
        `<strong>Replying to ${escapeHtml(replyTarget.sender)}</strong>: ${escapeHtml(replyTarget.text)}`;
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;

    const messageId =
        crypto.randomUUID?.() ||
        `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const targetChat = currentChat;
    const replyTo = replyTarget ? replyTarget.id : null;

    if (targetChat === "general") {
        socket.send(JSON.stringify({
            type: "chat",
            id: messageId,
            sender: myName,
            text,
            replyTo,
            timestamp: new Date().toISOString()
        }));
        addToConversation("general", {
            id: messageId, sender: myName, text, replyTo,
            timestamp: new Date().toISOString(),
            isMe: true, reactions: {}, type: "general"
        }, false);
    } else {
        socket.send(JSON.stringify({
            type: "private_chat",
            id: messageId,
            sender: myName,
            recipient: targetChat,
            text,
            replyTo,
            timestamp: new Date().toISOString()
        }));
        addToConversation(getPrivateThreadKey(myName, targetChat), {
            id: messageId, sender: myName, text, replyTo,
            timestamp: new Date().toISOString(),
            isMe: true, reactions: {}, type: "private"
        }, false);
    }

    messageInput.value = "";
    replyTarget = null;
    updateReplyPreview();
    updateTypingState(false);
    sendBtn.disabled = true;
    renderMessages();
}

function handleIncomingMessage(data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "user-list") {
        updateUserList(Array.isArray(data.users) ? data.users : []);
        return;
    }
    if (data.type === "system") {
        addSystemMessage(data.text || "System notification");
        return;
    }
    if (data.type === "typing") {
        updateTypingUsers(data);
        return;
    }
    if (data.type === "reaction") {
        if (data.sender && data.sender === myName) return;
        applyReaction(data);
        return;
    }
    if (data.type === "private_chat") {
        const targetKey = getPrivateThreadKey(data.sender, data.recipient || myName);
        const isCurrentThread =
            currentChat === data.sender || currentChat === data.recipient;

        addToConversation(targetKey, {
            id: data.id || `${data.sender}-${data.timestamp}`,
            sender: data.sender,
            text: data.text || "",
            replyTo: data.replyTo || null,
            timestamp: data.timestamp,
            isMe: data.sender === myName,
            reactions: {},
            type: "private"
        }, true);

        if (!isCurrentThread && data.sender !== myName) {
            unreadByThread.set(targetKey, (unreadByThread.get(targetKey) || 0) + 1);
            notifyIncomingMessage(data);
        }
        if (isCurrentThread) renderMessages();
        return;
    }

    if (data.type === "chat" || data.sender) {
        if (data.sender === "[SYSTEM]") {
            addSystemMessage(data.text || "System message");
            return;
        }
        const isCurrentThread = currentChat === "general";
        addToConversation("general", {
            id: data.id || `${data.sender}-${data.timestamp}`,
            sender: data.sender,
            text: data.text || "",
            replyTo: data.replyTo || null,
            timestamp: data.timestamp,
            isMe: data.sender === myName,
            reactions: {},
            type: "general"
        }, true);
        if (!isCurrentThread && data.sender !== myName) {
            unreadByThread.set("general", (unreadByThread.get("general") || 0) + 1);
            notifyIncomingMessage(data);
        }
        if (currentChat === "general") renderMessages();
    }
}

function setConnectionState(isOnline) {
    statusDot.classList.toggle("online", isOnline);
    statusText.textContent = isOnline ? "Online" : "Offline";
}

function getPrivateThreadKey(a, b) {
    const users = [a, b].filter(Boolean).sort();
    return users.length === 2 ? `private:${users[0]}::${users[1]}` : "general";
}

document.addEventListener("click", (event) => {
    if (!emojiPicker.hidden) {
        if (!emojiPicker.contains(event.target) && event.target !== emojiBtn) {
            emojiPicker.hidden = true;
        }
    }
});

function addToConversation(threadKey, message, shouldRender) {
    if (!conversationStore[threadKey]) conversationStore[threadKey] = [];

    const existingIndex = conversationStore[threadKey].findIndex(
        (m) =>
            (message.id && m.id === message.id) ||
            (m.sender === message.sender &&
                m.text === message.text &&
                m.timestamp === message.timestamp)
    );

    if (existingIndex >= 0) {
        const entry = conversationStore[threadKey][existingIndex];
        if (message.reactions) {
            entry.reactions = { ...(entry.reactions || {}), ...message.reactions };
        }
        if (message.replyTo !== undefined) entry.replyTo = message.replyTo;
        if (shouldRender) renderMessages();
        return;
    }

    conversationStore[threadKey].push({
        id: message.id || `${message.sender}-${message.timestamp}`,
        sender: message.sender,
        text: message.text,
        replyTo: message.replyTo || null,
        timestamp: message.timestamp,
        isMe: Boolean(message.isMe),
        reactions: message.reactions || {},
        type: message.type || "general"
    });

    if (shouldRender) renderMessages();
}

function renderMessages() {
    const activeThread =
        currentChat === "general"
            ? "general"
            : getPrivateThreadKey(myName, currentChat);
    clearUnreadForThread(activeThread);
    const threadMessages = conversationStore[activeThread] || [];
    const filtered = currentSearchQuery
        ? threadMessages.filter((m) =>
              `${m.sender || ""} ${m.text || ""}`.toLowerCase().includes(currentSearchQuery)
          )
        : threadMessages;

    messagesDiv.innerHTML = "";

    if (filtered.length === 0) {
        const placeholder = document.createElement("div");
        placeholder.className = "system-message";
        placeholder.textContent = currentSearchQuery
            ? "No messages match your search."
            : currentChat === "general"
            ? "Say hello to the room"
            : `Start a private conversation with ${currentChat}`;
        messagesDiv.appendChild(placeholder);
        updateUserList(latestOnlineUsers);
        return;
    }

    filtered.forEach((msg) => {
        addMessage(
            msg.sender,
            msg.text || "",
            formatTime(msg.timestamp),
            msg.isMe,
            msg.id,
            msg.replyTo,
            msg.reactions || {}
        );
    });

    updateUserList(latestOnlineUsers);
}

function setActiveRoom(user) {
    if (user === "general") {
        currentChat = "general";
        chatTitle.textContent = "General Chat";
        chatSubtitle.textContent = "Team room";
        contactAvatar.textContent = "G";
        clearUnreadForThread("general");
        return;
    }
    currentChat = user;
    chatTitle.textContent = user;
    chatSubtitle.textContent = "online";
    contactAvatar.textContent = (user || "?").charAt(0).toUpperCase();
    clearUnreadForThread(getPrivateThreadKey(myName, user));
}

function updateTypingState(isTyping = messageInput.value.trim().length > 0) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !myName) return;
    socket.send(JSON.stringify({
        type: "typing",
        sender: myName,
        isTyping,
        timestamp: new Date().toISOString()
    }));
    if (typingTimer) clearTimeout(typingTimer);
    if (isTyping) typingTimer = setTimeout(() => updateTypingState(false), 1800);
}

function updateTypingUsers(data) {
    if (!data || !data.sender || data.sender === myName) return;
    if (data.isTyping) typingUsers.set(data.sender, Date.now());
    else typingUsers.delete(data.sender);

    const active = [...typingUsers.keys()].filter(Boolean);
    if (!active.length) {
        typingStatusEl.hidden = true;
        typingStatusEl.textContent = "";
        return;
    }
    typingStatusEl.hidden = false;
    typingStatusEl.textContent =
        active.length > 1
            ? `${active.length} people are typing...`
            : `${active[0]} is typing...`;
}

function updateUserList(users) {
    latestOnlineUsers = Array.isArray(users) ? users.filter(Boolean) : [];
    userList.innerHTML = "";
    const count = latestOnlineUsers.length;
    onlineCountEl.textContent = `${count} online`;

    if (!count) {
        userList.innerHTML =
            '<div class="online-user empty-state">No one else is online.</div>';
        return;
    }

    latestOnlineUsers.forEach((user) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `online-user ${currentChat === user ? "active" : ""}`;
        item.dataset.user = user;

        const avatar = document.createElement("div");
        avatar.className = "online-avatar";
        avatar.textContent = (user || "?").charAt(0).toUpperCase();

        const summary = document.createElement("div");
        summary.className = "conversation-summary";

        const header = document.createElement("div");
        header.className = "conversation-header";

        const name = document.createElement("span");
        name.className = "conversation-name";
        name.textContent = user === myName ? `${user} (You)` : user;

        const meta = document.createElement("span");
        meta.className = "conversation-time";
        meta.textContent = getThreadPreview(user).time;

        const preview = document.createElement("span");
        preview.className = "conversation-preview";
        preview.textContent = getThreadPreview(user).text;

        const badge = document.createElement("span");
        const unread = getUnreadCountForUser(user);
        badge.className = `unread-badge ${unread ? "visible" : ""}`;
        badge.textContent = unread;

        const presence = document.createElement("span");
        presence.className = "presence-dot";

        header.appendChild(name);
        header.appendChild(meta);
        summary.appendChild(header);
        summary.appendChild(preview);

        item.appendChild(avatar);
        item.appendChild(summary);
        item.appendChild(presence);
        if (unread) item.appendChild(badge);
        userList.appendChild(item);
    });
}

function getThreadPreview(user) {
    const threadKey = user === myName ? "general" : getPrivateThreadKey(myName, user);
    const threadMessages = conversationStore[threadKey] || [];
    if (!threadMessages.length) {
        return {
            text: user === myName ? "Your personal space" : "No messages yet",
            time: ""
        };
    }
    const last = threadMessages[threadMessages.length - 1];
    const previewText = String(last.text || "").replace(/\s+/g, " ").trim();
    const shortened =
        previewText.length > 24
            ? `${previewText.slice(0, 24)}…`
            : previewText || "New message";
    return { text: shortened, time: formatTime(last.timestamp) };
}

function getUnreadCountForUser(user) {
    const threadKey = user === myName ? "general" : getPrivateThreadKey(myName, user);
    return unreadByThread.get(threadKey) || 0;
}

function clearUnreadForThread(threadKey) {
    unreadByThread.delete(threadKey);
}

function addMessage(username, text, time, isMe, messageId = "", replyTo = null, reactions = {}) {
    const div = document.createElement("div");
    div.className = `message ${isMe ? "me" : "other"}`;
    div.dataset.messageId = messageId;

    const reply = resolveReplyContext(replyTo);

    const reactionHtml = Object.entries(reactions)
        .map(([key, count]) => {
            const img = imagePathFor(key);
            return `<button type="button" class="message-reaction" data-message-id="${messageId}" data-emoji="${escapeHtml(key)}">
                <img src="${escapeHtml(img)}" alt="${escapeHtml(key)}"> ${count}
            </button>`;
        })
        .join("");

    div.innerHTML = `
        ${!isMe ? `<div class="msg-username">${escapeHtml(username)}</div>` : ""}
        <div class="msg-bubble">
            ${reply ? `<div class="reply-inline"><strong>${escapeHtml(reply.sender)}</strong>: ${escapeHtml(reply.text)}</div>` : ""}
            ${renderMessageBody(text)}
            <div class="msg-time">${time}</div>
            ${reactionHtml ? `<div class="reaction-row">${reactionHtml}</div>` : ""}
        </div>
    `;

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderMessageBody(rawText) {
    let text = String(rawText ?? "").trim();
    text = text.replace(/^[`"'\s]+|[`"'\s]+$/g, "");

    const isImagePath =
        /^([\w\-./\\]*[\w\-]+\.(png|jpg|jpeg|gif|webp|svg))(\?.*)?$/i.test(text);

    if (isImagePath) {
        return `<div class="msg-sticker"><img src="${escapeHtml(text)}" alt="sticker"></div>`;
    }

    const lines = text.split("\n").map((line) => escapeHtml(line));
    const html = lines
        .map((line) =>
            line.replace(URL_PATTERN, (url) =>
                `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
            )
        )
        .join("<br>");

    return `<div class="msg-text">${html}</div>`;
}

function addSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function resolveReplyContext(replyToId) {
    if (!replyToId) return null;
    for (const threadKey of Object.keys(conversationStore)) {
        const match = (conversationStore[threadKey] || []).find(
            (m) => m.id === replyToId
        );
        if (match) return { sender: match.sender, text: match.text || "" };
    }
    return null;
}

function applyReaction(data) {
    if (!data || !data.messageId || !data.emoji) return;
    for (const threadKey of Object.keys(conversationStore)) {
        const message = (conversationStore[threadKey] || []).find(
            (m) => m.id === data.messageId
        );
        if (!message) continue;
        if (!message.reactions) message.reactions = {};
        message.reactions[data.emoji] = (message.reactions[data.emoji] || 0) + 1;
        if (
            currentChat === "general" ||
            currentChat === message.sender ||
            currentChat === myName
        ) {
            renderMessages();
        }
        return;
    }
}

function notifyIncomingMessage(data) {
    if (!data || !data.text || data.sender === myName) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const active =
        currentChat === "general"
            ? data.type === "chat"
            : currentChat === data.sender || currentChat === data.recipient;
    if (active) return;

    if (Notification.permission === "granted") {
        new Notification(`New message from ${data.sender}`, {
            body: data.text,
            tag: `timepass-${data.sender}-${Date.now()}`
        });
    }
}

function formatTime(isoString) {
    try { return isoString.split("T")[1].substring(0, 5); }
    catch { return "--:--"; }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text ?? "");
    return div.innerHTML;
}

function imagePathFor(key) {
    if (!key) return "";
    if (key.includes("/") || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(key)) return key;
    return "images/" + key;
}
