import React, { useEffect, useRef, useMemo } from 'react';

const ContextMenu = ({ isVisible, position, onClose, items, triggerRect }) => {
  const menuRef = useRef(null);

  // Calculate position immediately when props change, before render
  const adjustedPosition = useMemo(() => {
    if (!position || !isVisible) return { x: 0, y: 0 };
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let { x, y } = position;
    
    // Use estimates for menu dimensions to avoid DOM dependency
    const estimatedMenuWidth = 150; // Based on CSS min-width
    const estimatedMenuHeight = items ? items.length * 36 + 8 : 100; // Approximate
    
    // Horizontal adjustment
    if (x + estimatedMenuWidth > viewportWidth) {
      x = Math.max(10, viewportWidth - estimatedMenuWidth - 10);
    }
    if (x < 10) {
      x = 10;
    }
    
    // Vertical adjustment
    if (y + estimatedMenuHeight > viewportHeight) {
      if (triggerRect) {
        y = triggerRect.top - estimatedMenuHeight - 5;
      } else {
        y = position.y - estimatedMenuHeight - 5;
      }
      if (y < 10) {
        y = Math.max(10, viewportHeight - estimatedMenuHeight - 10);
      }
    }
    if (y < 10) {
      y = 10;
    }
    
    return { x, y };
  }, [position, triggerRect, items, isVisible]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        top: adjustedPosition.y,
        left: adjustedPosition.x,
        zIndex: 1000
      }}
    >
      <ul className="context-menu-list">
        {items.map((item, index) => (
          <li
            key={index}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''} ${item.recording ? 'recording' : ''}`}
            data-recording={item.recording || false}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled && item.onClick) {
                item.onClick();
                onClose();
              }
            }}
          >
            {item.icon && <i className={item.icon}></i>}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ContextMenu;
