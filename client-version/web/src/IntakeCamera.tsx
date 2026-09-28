import { useEffect, useRef, useState } from "react";
export default function IntakeCamera({
  selfie = false,
  barcode = false,
  onPhoto,
  onDetect,
  onCode,
  onClose,
}: {
  selfie?: boolean;
  barcode?: boolean;
  onPhoto: (file: File) => void;
  onDetect?: (file: File) => Promise<boolean>;
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  useEffect(() => {
    let closed = false,
      stream: MediaStream | undefined,
      timer: number | undefined;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: selfie ? "user" : "environment" },
        audio: false,
      })
      .then(async (s) => {
        if (closed) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
          setReady(true);
        }
        if (onDetect && !barcode && !selfie) {
          timer = window.setInterval(async () => {
            if (closed || checkingRef.current || !video.current?.videoWidth) return;
            checkingRef.current = true;
            setChecking(true);
            try {
              const file = await frameFile(true);
              if (file && !closed && await onDetect(file)) {
                closed = true;
                onClose();
              }
            } catch {
              // A moving or unreadable frame simply waits for the next scan.
            } finally {
              checkingRef.current = false;
              if (!closed) setChecking(false);
            }
          }, 2800);
        } else if (barcode) {
          const Detector = (window as any).BarcodeDetector;
          if (!Detector) {
            setError(
              "Barcode scanning is unavailable in this browser. Enter the serial below.",
            );
            return;
          }
          const detector = new Detector();
          timer = window.setInterval(async () => {
            if (!video.current || closed) return;
            try {
              const codes = await detector.detect(video.current);
              if (codes[0] && !closed) {
                closed = true;
                onCode(codes[0].rawValue);
                onClose();
              }
            } catch {}
          }, 500);
        }
      })
      .catch(() => {
        if (!closed) setError("Camera unavailable. Use Upload photo.");
      });
    return () => {
      closed = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function frameFile(auto = false): Promise<File | undefined> {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    const scale = Math.min(1, 1200 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    if (auto) {
      const sample = document.createElement("canvas");
      sample.width = 40;
      sample.height = 26;
      const context = sample.getContext("2d")!;
      context.drawImage(c, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      let bright = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114 > 155) bright++;
      }
      if (bright / (sample.width * sample.height) <= .16) return;
    }
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.78));
    return blob ? new File([blob], "capture.jpg", {type: "image/jpeg"}) : undefined;
  }
  async function capture() {
    const file = await frameFile();
    if (file) {
      onPhoto(file);
      onClose();
    }
  }
  return (
    <section className="intake-camera" aria-label="Camera">
      <video ref={video} autoPlay playsInline muted />
      {!selfie && <div className="camera-scan-frame"><div className="camera-scan-line" /></div>}
      {onDetect && !selfie && <span className="camera-scan-status" role="status">{checking ? "Reading document…" : "Hold document inside frame"}</span>}
      {error && <p role="alert">{error}</p>}
      <div>
        <button type="button" onClick={onClose}>
          Close camera
        </button>
        {!barcode && (
          <button
            type="button"
            className="primary"
            disabled={!ready}
            onClick={capture}
          >
            Capture
          </button>
        )}
      </div>
    </section>
  );
}
