import { useEffect, useRef, useState } from "react";

interface Props {
  message: string | null;
  onDismiss: () => void;
}

export default function TutorialFeedback({ message, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(() => onDismissRef.current(), 300);
      }, 6000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!message) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 110,
        maxWidth: 420,
        padding: "10px 16px",
        background: "rgba(210, 153, 34, 0.15)",
        border: "1px solid rgba(210, 153, 34, 0.4)",
        borderRadius: 6,
        backdropFilter: "blur(4px)",
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        color: "#d29922",
        lineHeight: 1.5,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 1.5,
          marginRight: 8,
          opacity: 0.8,
        }}
      >
        TIP
      </span>
      {message}
    </div>
  );
}
