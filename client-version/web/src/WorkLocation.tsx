import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MapPin, ShieldAlert } from "lucide-react";
import { api, post, Row, setCaptureLocationGuard, setWorkLogoutGuard } from "./api";

export type GPS = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  captured_at: string;
  mocked: false;
  device: string;
};
const WorkContext = createContext<{
  me?: Row;
  error: string;
  busy: boolean;
  otherDevice: boolean;
  start: () => Promise<void>;
  end: () => Promise<void>;
  refresh: () => Promise<void>;
}>({
  error: "",
  busy: false,
  otherDevice: false,
  start: async () => {},
  end: async () => {},
  refresh: async () => {},
});
export const useWorkLocation = () => useContext(WorkContext);
const message = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : "Location could not be recorded. Try again.";

export function currentGPS(device = "Web portal"): Promise<GPS> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(
        new Error(
          "Location needs a secure connection and a supported browser.",
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
          captured_at: new Date(position.timestamp).toISOString(),
          mocked: false,
          device,
        }),
      (failure) =>
        reject(
          new Error(
            failure.code === 1
              ? "Location access is blocked. Allow location in your browser settings, then try again."
              : failure.code === 2
                ? "Your location is unavailable. Move to a place with a clearer GPS signal and try again."
                : "Location timed out. Check location services and try again.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  });
}

export function WorkLocationProvider({
  user,
  children,
}: {
  user: Row;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const allowed = ["location.self", "location.read", "location.manage"].some(
    (grant) => user.permissions?.includes(grant),
  );
  const canTrack = user.permissions?.includes("location.self");
  const device = useMemo(() => {
    const key = `qanawat.location.device.${user.id}`;
    let saved = localStorage.getItem(key);
    if (!saved) {
      saved = crypto.randomUUID();
      localStorage.setItem(key, saved);
    }
    return `Qanawat web:${saved}`;
  }, [user.id]);
  const me = useQuery<Row>({
    queryKey: ["work-location", "me", user.id],
    queryFn: () => api("/location-tracking/me"),
    enabled: allowed,
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const collecting = useRef(false);
  const generation = useRef(0),
    stoppedSessions = useRef(new Set<string>());
  const sessionRef = useRef<Row | null>(null);
  const lastPosted = useRef(0);
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [user.id]);
  const invalidate = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["work-location", "me", user.id] }),
      client.invalidateQueries({ queryKey: ["work-location", "members"] }),
    ]);
  }, [client, user.id]);
  const session = me.data?.work_session?.ended_at
    ? null
    : me.data?.work_session;
  sessionRef.current = session || null;
  const otherDevice = !!session && session.device !== device;
  useEffect(() => {
    setWorkLogoutGuard(async () => {
      generation.current++;
      const current = sessionRef.current;
      if (!current?.id || current.device !== device) return;
      stoppedSessions.current.add(current.id);
      try {
        await post("/location-tracking/end", { session_id: current.id });
      } catch {
        // Sign-out remains available offline; local collection is already stopped.
        // A remote session that could not close is visibly stale, never a live fix.
      }
    });
    return () => setWorkLogoutGuard(null);
  }, [user.id, device]);
  const refresh = useCallback(async () => {
    if (
      !canTrack ||
      !session?.id ||
      otherDevice ||
      collecting.current ||
      Date.now() - lastPosted.current < 1500
    )
      return;
    const epoch = generation.current,
      sessionId = session.id;
    collecting.current = true;
    try {
      const gps = await currentGPS(device);
      if (
        epoch !== generation.current ||
        document.visibilityState !== "visible" ||
        sessionRef.current?.id !== sessionId ||
        stoppedSessions.current.has(sessionId)
      )
        return;
      await post("/location-tracking/points", {
        ...gps,
        session_id: sessionId,
      });
      if (epoch !== generation.current) return;
      lastPosted.current = Date.now();
      setError("");
      await invalidate();
    } catch (failure) {
      if (
        epoch === generation.current &&
        !stoppedSessions.current.has(sessionId)
      )
        setError(message(failure));
    } finally {
      collecting.current = false;
    }
  }, [canTrack, session?.id, otherDevice, device, invalidate]);
  useEffect(() => {
    if (!canTrack || !session?.id || otherDevice) return;
    const collect = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(collect, 25000);
    document.addEventListener("visibilitychange", collect);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", collect);
    };
  }, [canTrack, session?.id, otherDevice, refresh]);
  useEffect(() => {
    if (!allowed) return;
    setCaptureLocationGuard(async () => {
      const epoch = generation.current;
      const cancelled = () =>
        epoch !== generation.current || document.visibilityState !== "visible";
      const blocked = (text: string) =>
        Object.assign(new Error(text), { status: 403 });
      const state = await api("/location-tracking/me");
      if (cancelled())
        throw blocked(
          "Location check cancelled. Return to the signed-in work screen and try again.",
        );
      if (!state.enabled) return;
      if (!canTrack)
        throw blocked(
          "Your account does not have permission to record a work location. Ask an administrator to check your access.",
        );
      if (!state.work_session?.id || state.work_session.ended_at)
        throw Object.assign(
          new Error(
            "Start work tracking inside your assigned boundary before capturing a sale. Open Work location to continue.",
          ),
          { status: 403 },
        );
      if (state.work_session.device !== device)
        throw blocked(
          "Work tracking is active on another device. Open Work location and end that session before starting tracking here.",
        );
      if (Date.now() - lastPosted.current < 1500)
        await new Promise((resolve) =>
          setTimeout(resolve, 1500 - (Date.now() - lastPosted.current)),
        );
      const gps = await currentGPS(device).catch((failure) => {
        throw Object.assign(new Error(message(failure)), { status: 403 });
      });
      if (cancelled() || stoppedSessions.current.has(state.work_session.id))
        throw blocked(
          "Work tracking has ended. Start a new work session before capturing a sale.",
        );
      const current = await api("/location-tracking/me");
      if (
        cancelled() ||
        current.work_session?.id !== state.work_session.id ||
        current.work_session?.ended_at
      )
        throw blocked(
          "Work tracking has ended. Start a new work session before capturing a sale.",
        );
      await post("/location-tracking/points", {
        ...gps,
        session_id: state.work_session.id,
      });
      if (cancelled())
        throw blocked(
          "Location check cancelled. Return to the signed-in work screen and try again.",
        );
      lastPosted.current = Date.now();
      const confirmed = await api("/location-tracking/me");
      if (cancelled())
        throw blocked(
          "Location check cancelled. Return to the signed-in work screen and try again.",
        );
      client.setQueryData(["work-location", "me", user.id], confirmed);
      if (!confirmed.can_capture)
        throw Object.assign(
          new Error(
            confirmed.reason ||
              "Capturing a sale is blocked outside your assigned boundary.",
          ),
          { status: 403 },
        );
    });
    return () => setCaptureLocationGuard(null);
  }, [allowed, canTrack, client, user.id, device]);
  const start = async () => {
    const epoch = generation.current;
    setBusy(true);
    setError("");
    try {
      const gps = await currentGPS(device);
      if (
        epoch !== generation.current ||
        document.visibilityState !== "visible"
      )
        return;
      await post("/location-tracking/start", gps);
      if (epoch !== generation.current) return;
      lastPosted.current = Date.now();
      await invalidate();
    } catch (failure) {
      if (epoch === generation.current) setError(message(failure));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  const end = async () => {
    if (!session?.id) return;
    const epoch = generation.current,
      sessionId = session.id;
    stoppedSessions.current.add(sessionId);
    setBusy(true);
    setError("");
    try {
      await post("/location-tracking/end", { session_id: sessionId });
      if (epoch !== generation.current) return;
      await invalidate();
    } catch (failure) {
      stoppedSessions.current.delete(sessionId);
      if (epoch === generation.current) setError(message(failure));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  return (
    <WorkContext.Provider
      value={{
        me: me.data,
        error: error || (me.error ? message(me.error) : ""),
        busy,
        otherDevice,
        start,
        end,
        refresh,
      }}
    >
      {children}
    </WorkContext.Provider>
  );
}

export function WorkLocationNotice() {
  const { me, error, otherDevice } = useWorkLocation();
  if (!me?.work_session || me.work_session.ended_at) return null;
  return (
    <div
      className={`work-location-notice ${error ? "attention" : ""}`}
      role="status"
    >
      <MapPin size={17} />
      <span>
        <strong>Work location tracking on</strong> ·{" "}
        {error ||
          (otherDevice
            ? "Active on another device; this browser is not collecting location"
            : "Updates while this browser is open and visible")}
      </span>
      <Link to="/location-tracking">View or end tracking</Link>
    </div>
  );
}

export function CaptureBoundaryNotice() {
  const { me } = useWorkLocation();
  if (!me?.enabled) return null;
  return (
    <div
      className={`capture-boundary-notice ${me.can_capture ? "ready" : "attention"}`}
      role="status"
    >
      <ShieldAlert size={18} />{" "}
      <span>
        {me.can_capture
          ? `Work boundary: ${me.boundary?.name || "Assigned location"}. Location is checked again when you capture or submit.`
          : me.reason ||
            "Start work tracking inside your assigned boundary to capture a sale."}
      </span>
      <Link to="/location-tracking">Work location</Link>
    </div>
  );
}
