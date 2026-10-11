import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WIDTH = 480;
const HEIGHT = 160;

/**
 * Draw with a mouse, pen or finger. Each finished stroke reports the whole pad as a PNG
 * `data:` URL, the format signature fields take (docs/features/template-fields-and-guided-form.md).
 */
export function SignaturePad({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  /** The URL this pad last produced, so its own output isn't redrawn on top of itself. */
  const drawn = useRef<string | undefined>(undefined);

  // Shows a value that came from elsewhere (saved sample data, "Fill with examples").
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || value === drawn.current) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawn.current = value;
    if (!value) return;
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
    image.src = value;
  }, [value]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  };

  const finish = () => {
    if (!drawing.current || !canvas.current) return;
    drawing.current = false;
    drawn.current = canvas.current.toDataURL("image/png");
    onChange(drawn.current);
  };

  return (
    <div className="space-y-1.5">
      <canvas
        id={id}
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Signature pad"
        aria-invalid={invalid}
        className={cn(
          "aspect-[3/1] w-full max-w-md touch-none rounded-lg border border-input bg-white",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-crosshair",
          invalid && "border-destructive",
        )}
        onPointerDown={(e) => {
          const ctx = e.currentTarget.getContext("2d");
          if (disabled || !ctx) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const { x, y } = point(e);
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = "#111827";
          ctx.beginPath();
          ctx.moveTo(x, y);
          // A dot for a tap without movement.
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          const ctx = e.currentTarget.getContext("2d");
          if (!drawing.current || !ctx) return;
          const { x, y } = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{value ? "Signed." : "Sign in the box."}</span>
        {value && !disabled && (
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(undefined)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
