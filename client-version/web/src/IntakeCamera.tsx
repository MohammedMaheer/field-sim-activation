import { useEffect, useRef, useState } from "react";
export default function IntakeCamera({
  selfie = false,
  barcode = false,
  onPhoto,
  onCode,
  onClose,
}: {
  selfie?: boolean;
  barcode?: boolean;
  onPhoto: (file: File) => void;
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false);
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
        if (barcode) {
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
  function capture() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(
      (b) => {
        if (b) {
          onPhoto(new File([b], "capture.jpg", { type: "image/jpeg" }));
          onClose();
        }
      },
      "image/jpeg",
      0.85,
    );
  }
  return (
    <section className="intake-camera" aria-label="Camera">
      <video ref={video} autoPlay playsInline muted />
      <div className="camera-scan-line" />
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
