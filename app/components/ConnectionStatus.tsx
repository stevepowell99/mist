import { useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";

const readyStates = {
  [WebSocket.CONNECTING]: {
    text: "Connecting",
    dotClass: "bg-yellow-500",
  },
  [WebSocket.OPEN]: {
    text: "Connected",
    dotClass: "bg-green-500",
  },
  [WebSocket.CLOSING]: {
    text: "Closing",
    dotClass: "bg-orange-500",
  },
  [WebSocket.CLOSED]: {
    text: "Offline",
    dotClass: "bg-red-500",
  },
};

export default function ConnectionStatus() {
  const { yjs } = useDocument();
  const socket = yjs.socket;

  const [readyState, setReadyState] = useState<number>(
    socket?.readyState === 1 ? 1 : 0,
  );
  const display = readyStates[readyState as keyof typeof readyStates];

  useEffect(() => {
    if (!socket) return;

    const onStateChange = () => setReadyState(socket.readyState);
    socket.addEventListener("open", onStateChange);
    socket.addEventListener("close", onStateChange);
    return () => {
      socket.removeEventListener("open", onStateChange);
      socket.removeEventListener("close", onStateChange);
    };
  }, [socket]);

  return (
    <span
      className="inline-flex items-center"
      title={display.text}
      aria-label={`Connection: ${display.text}`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${display.dotClass}`} />
    </span>
  );
}
