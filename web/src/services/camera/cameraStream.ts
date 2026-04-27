import type { CameraConfig } from '../../types/camera';

export interface OpenStreamOptions {
  deviceId: string;
  config: CameraConfig;
}

export interface CameraStream {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  /** Fires when the underlying track ends (disconnect, permission revoked). */
  onEnded: (cb: () => void) => () => void;
  stop(): void;
}

function parseResolution(s: CameraConfig['resolution']): { width: number; height: number } {
  const [w, h] = s.split('x').map((n) => Number.parseInt(n, 10));
  return { width: w, height: h };
}

export async function openCameraStream(opts: OpenStreamOptions): Promise<CameraStream> {
  const { width, height } = parseResolution(opts.config.resolution);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: opts.deviceId },
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: opts.config.fps },
    },
  });
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No video track returned by getUserMedia');
  }

  return {
    stream,
    videoTrack,
    onEnded(cb) {
      const handler = () => cb();
      videoTrack.addEventListener('ended', handler);
      return () => videoTrack.removeEventListener('ended', handler);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
