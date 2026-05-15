import { useEffect, useRef } from "react";

const Terminal = ({ lines }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div className="terminal" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={`terminal-line terminal-line--${l.type || "default"}`}>
          {l.msg}
        </div>
      ))}
    </div>
  );
};

export default Terminal;
