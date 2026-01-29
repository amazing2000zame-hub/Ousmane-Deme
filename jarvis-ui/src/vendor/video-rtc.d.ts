/**
 * Type declarations for video-rtc.js web component from go2rtc.
 * @see https://github.com/AlexxIT/go2rtc
 */

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'video-rtc': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          /** Stream URL - http:// is auto-converted to ws:// */
          src?: string;
          /** Protocol preference: 'mse,webrtc,hls,mjpeg' */
          mode?: string;
          /** Requested streams: 'video,audio' or 'video' */
          media?: string;
          /** Keep stream when tab hidden */
          background?: boolean;
          /** Auto-play with muted fallback */
          autoplay?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

export interface VideoRTCElement extends HTMLElement {
  src: string;
  mode: string;
  media: string;
  background: boolean;
  wsState: number;
  pcState: number;
  play(): void;
  send(msg: object): void;
}

export {};
