import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../css/messages.css';

export default function MessagesPage() {
    const [conversations, setConversations] = useState([]);
    const [selectedConversation, setSelectedConversation] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [showNewChat, setShowNewChat] = useState(false);
    const messagesEndRef = useRef(null);
    const messageInputRef = useRef(null);

    // Mock conversations data
    const mockConversations = [
        {
            id: 1,
            name: 'System Alerts',
            avatar: '🔔',
            lastMessage: 'Camera maintenance scheduled for Sunday at 2:00 AM',
            timestamp: new Date('2025-06-26T10:30:00'),
            unreadCount: 2,
            isOnline: true,
            isGroup: false,
            messages: [
                {
                    id: 1,
                    text: 'Camera system maintenance will occur on Sunday at 2:00 AM. Expected downtime is 30 minutes.',
                    timestamp: new Date('2025-06-25T14:30:00'),
                    sender: 'system',
                    isOwn: false
                },
                {
                    id: 2,
                    text: 'All cameras are back online. Maintenance completed successfully.',
                    timestamp: new Date('2025-06-26T02:45:00'),
                    sender: 'system',
                    isOwn: false
                }
            ]
        },
        {
            id: 2,
            name: 'John Doe',
            avatar: '👤',
            lastMessage: 'New camera setup is complete',
            timestamp: new Date('2025-06-25T16:45:00'),
            unreadCount: 0,
            isOnline: true,
            isGroup: false,
            messages: [
                {
                    id: 1,
                    text: 'Hey, I need to add a new camera to the Test Client location',
                    timestamp: new Date('2025-06-24T10:15:00'),
                    sender: 'John Doe',
                    isOwn: false
                },
                {
                    id: 2,
                    text: 'Sure, I can help you with that. What type of camera are you adding?',
                    timestamp: new Date('2025-06-24T10:16:00'),
                    sender: 'You',
                    isOwn: true
                },
                {
                    id: 3,
                    text: 'It\'s a new IP camera for the parking area',
                    timestamp: new Date('2025-06-24T10:17:00'),
                    sender: 'John Doe',
                    isOwn: false
                },
                {
                    id: 4,
                    text: 'Perfect! I\'ve added it to the system. You should see it in the live feeds now.',
                    timestamp: new Date('2025-06-24T10:20:00'),
                    sender: 'You',
                    isOwn: true
                },
                {
                    id: 5,
                    text: 'New camera setup is complete',
                    timestamp: new Date('2025-06-25T16:45:00'),
                    sender: 'John Doe',
                    isOwn: false
                }
            ]
        },
        {
            id: 3,
            name: 'Tech Support Team',
            avatar: '👥',
            lastMessage: 'Issue resolved - all feeds operational',
            timestamp: new Date('2025-06-23T16:45:00'),
            unreadCount: 0,
            isOnline: false,
            isGroup: true,
            messages: [
                {
                    id: 1,
                    text: 'We\'re experiencing connection issues with Test Client 2 cameras',
                    timestamp: new Date('2025-06-23T14:30:00'),
                    sender: 'Tech Support',
                    isOwn: false
                },
                {
                    id: 2,
                    text: 'I\'m looking into it now',
                    timestamp: new Date('2025-06-23T14:35:00'),
                    sender: 'You',
                    isOwn: true
                },
                {
                    id: 3,
                    text: 'Issue resolved - all feeds operational',
                    timestamp: new Date('2025-06-23T16:45:00'),
                    sender: 'Tech Support',
                    isOwn: false
                }
            ]
        },
        {
            id: 4,
            name: 'Management',
            avatar: '💼',
            lastMessage: 'Weekly report looks good',
            timestamp: new Date('2025-06-22T09:00:00'),
            unreadCount: 0,
            isOnline: false,
            isGroup: false,
            messages: [
                {
                    id: 1,
                    text: 'Can you send me the weekly status report?',
                    timestamp: new Date('2025-06-21T17:00:00'),
                    sender: 'Management',
                    isOwn: false
                },
                {
                    id: 2,
                    text: 'Here\'s this week\'s report:\n• 18 cameras online\n• 2 clients active\n• 99.2% uptime\n• No critical alerts',
                    timestamp: new Date('2025-06-22T09:00:00'),
                    sender: 'You',
                    isOwn: true
                },
                {
                    id: 3,
                    text: 'Weekly report looks good',
                    timestamp: new Date('2025-06-22T09:15:00'),
                    sender: 'Management',
                    isOwn: false
                }
            ]
        }
    ];

    useEffect(() => {
        setConversations(mockConversations);
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [selectedConversation]);

    // Auto-resize textarea
    useEffect(() => {
        if (messageInputRef.current) {
            messageInputRef.current.style.height = 'auto';
            messageInputRef.current.style.height = messageInputRef.current.scrollHeight + 'px';
        }
    }, [newMessage]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const filteredConversations = conversations.filter(conv =>
        conv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleConversationClick = useCallback((conversation) => {
        setSelectedConversation(conversation);
        // Mark as read
        setConversations(prev => prev.map(conv =>
            conv.id === conversation.id ? { ...conv, unreadCount: 0 } : conv
        ));
    }, []);

    const handleSendMessage = useCallback((e) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedConversation) return;

        const message = {
            id: Date.now(),
            text: newMessage.trim(),
            timestamp: new Date(),
            sender: 'You',
            isOwn: true
        };

        // Add message to conversation
        setConversations(prev => prev.map(conv => {
            if (conv.id === selectedConversation.id) {
                const updatedConv = {
                    ...conv,
                    messages: [...conv.messages, message],
                    lastMessage: message.text,
                    timestamp: message.timestamp
                };
                setSelectedConversation(updatedConv);
                return updatedConv;
            }
            return conv;
        }));

        setNewMessage('');
        setTimeout(scrollToBottom, 100);
    }, [newMessage, selectedConversation]);

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage(e);
        }
    };

    const formatTime = (timestamp) => {
        const now = new Date();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (minutes < 1) return 'now';
        if (minutes < 60) return `${minutes}m`;
        if (hours < 24) return `${hours}h`;
        if (days === 1) return 'yesterday';
        if (days < 7) return `${days}d`;
        return timestamp.toLocaleDateString();
    };

    const formatMessageTime = (timestamp) => {
        return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="messenger-container">
            {/* Sidebar */}
            <div className="messenger-sidebar">
                <div className="messenger-header">
                    <div className="header-title">
                        <h2>Messages</h2>
                        <span className="online-count">{conversations.filter(c => c.isOnline).length} online</span>
                    </div>
                    <div className="header-actions">
                        <button className="action-btn" onClick={() => setShowNewChat(true)} title="New chat">
                            <i className="fa fa-edit"></i>
                        </button>
                        <button className="action-btn" title="More options">
                            <i className="fa fa-ellipsis-vertical"></i>
                        </button>
                    </div>
                </div>

                <div className="search-container">
                    <input
                        type="text"
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input"
                    />
                </div>

                <div className="conversations-list">
                    {filteredConversations.map(conversation => (
                        <div
                            key={conversation.id}
                            className={`conversation-item ${selectedConversation?.id === conversation.id ? 'active' : ''}`}
                            onClick={() => handleConversationClick(conversation)}
                        >
                            <div className="avatar-container">
                                <div className="avatar">{conversation.avatar}</div>
                                {conversation.isOnline && <div className="online-dot"></div>}
                            </div>
                            <div className="conversation-info">
                                <div className="conversation-header">
                                    <span className="name">{conversation.name}</span>
                                    <span className="time">{formatTime(conversation.timestamp)}</span>
                                </div>
                                <div className="last-message">
                                    <span className={`message-text ${conversation.unreadCount > 0 ? 'unread' : ''}`}>
                                        {conversation.lastMessage}
                                    </span>
                                    {conversation.unreadCount > 0 && (
                                        <span className="unread-badge">{conversation.unreadCount}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat Area */}
            <div className="chat-area">
                {selectedConversation ? (
                    <>
                        <div className="chat-header">
                            <div className="chat-user-info">
                                <div className="avatar">{selectedConversation.avatar}</div>
                                <div className="user-details">
                                    <h3>{selectedConversation.name}</h3>
                                    <span className="status">
                                        {selectedConversation.isOnline ? (
                                            <>
                                                <span className="online-dot small"></span>
                                                Active now
                                            </>
                                        ) : (
                                            'Offline'
                                        )}
                                    </span>
                                </div>
                            </div>
                            <div className="chat-actions">
                                <button className="action-btn" title="Voice call">
                                    <i className="fa fa-phone"></i>
                                </button>
                                <button className="action-btn" title="Video call">
                                    <i className="fa fa-video"></i>
                                </button>
                                <button className="action-btn" title="More options">
                                    <i className="fa fa-ellipsis-vertical"></i>
                                </button>
                            </div>
                        </div>

                        <div className="messages-container">
                            <div className="messages-list">
                                {selectedConversation.messages.map((message, index) => {
                                    const showTimestamp = index === 0 || 
                                        (selectedConversation.messages[index - 1].timestamp.toDateString() !== message.timestamp.toDateString()) ||
                                        (message.timestamp - selectedConversation.messages[index - 1].timestamp > 300000); // 5 minutes

                                    return (
                                        <div key={message.id}>
                                            {showTimestamp && (
                                                <div className="timestamp-divider">
                                                    {message.timestamp.toDateString() === new Date().toDateString() 
                                                        ? 'Today' 
                                                        : message.timestamp.toLocaleDateString()
                                                    }
                                                </div>
                                            )}
                                            <div className={`message ${message.isOwn ? 'own' : 'other'}`}>
                                                <div className="message-content">
                                                    <span className="message-text">{message.text}</span>
                                                    <span className="message-time">{formatMessageTime(message.timestamp)}</span>
                                                    {message.isOwn && (
                                                        <span className="message-status">
                                                            <i className="fa fa-check-double"></i>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        <form className="message-input-container" onSubmit={handleSendMessage}>
                            <div className="input-wrapper">
                                <button type="button" className="emoji-btn" title="Add emoji">
                                    <i className="fa fa-smile"></i>
                                </button>
                                <textarea
                                    ref={messageInputRef}
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="Type a message..."
                                    className="message-input"
                                    rows={1}
                                />
                                <button type="button" className="attach-btn" title="Attach file">
                                    <i className="fa fa-paperclip"></i>
                                </button>
                            </div>
                            <button 
                                type="submit" 
                                className={`send-btn ${newMessage.trim() ? 'active' : ''}`}
                                disabled={!newMessage.trim()}
                            >
                                <i className="fa fa-paper-plane"></i>
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="no-chat-selected">
                        <div className="welcome-message">
                            <i className="fa fa-comments"></i>
                            <h3>Welcome to Messages</h3>
                            <p>Select a conversation to start messaging</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
