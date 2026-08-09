import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ViewTransform, Viewport } from './tree-layout.ts';

/**
 * Pan and zoom for the tree and timeline canvases.
 *
 * Pointer Events cover mouse, touch and pen with one code path, and pointer
 * capture keeps a drag alive when the cursor leaves the element. Two active
 * pointers switch to pinch-zoom.
 */

export interface PanZoomOptions {
  minScale?: number;
  maxScale?: number;
  /** 'x' locks vertical movement — the timeline only travels sideways. */
  axis?: 'both' | 'x';
  zoomable?: boolean;
  /** Content size in canvas units, used to stop it being flung out of view. */
  content?: { width: number; height: number };
}

export interface PanZoom {
  /**
   * Callback ref, not an object ref: the screens render a loading state before
   * the canvas exists, so measurement has to be driven by the node attaching
   * rather than by mount.
   */
  containerRef: (node: HTMLDivElement | null) => void;
  viewport: Viewport;
  transform: ViewTransform;
  setTransform: (next: ViewTransform) => void;
  isDragging: boolean;
  /** True when the current gesture moved far enough to count as a drag. */
  consumedDrag: () => boolean;
  zoomBy: (factor: number) => void;
  /** Zoom about a point given in viewport (client) coordinates — double-tap. */
  zoomAtClient: (factor: number, clientX: number, clientY: number) => void;
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
    onWheel: (event: React.WheelEvent<HTMLElement>) => void;
  };
}

/** Movement past this many pixels means the gesture was a pan, not a tap. */
const DRAG_THRESHOLD = 6;

/** How much of the content must stay within the viewport, in screen pixels. */
const KEEP_VISIBLE = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp between two bounds without assuming which one is the lower.
 *
 * The pan limits are written as "how far past the edge may the content go",
 * which only puts them in order while the content is *larger* than the
 * viewport. A tree small enough to fit inverts them, and a plain clamp then
 * collapses to whichever bound it tests last — pinning the canvas against one
 * edge and quietly undoing the centring that fitView just computed.
 */
function clampBetween(value: number, a: number, b: number): number {
  return clamp(value, Math.min(a, b), Math.max(a, b));
}

export function usePanZoom(options: PanZoomOptions = {}): PanZoom {
  const {
    minScale = 0.2,
    maxScale = 2.4,
    axis = 'both',
    zoomable = true,
    content,
  } = options;

  // The node is tracked in both a ref (read synchronously during gestures) and
  // state (so the measuring effect re-runs when it attaches or detaches).
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    setElement(node);
  }, []);

  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [transform, setTransformState] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [isDragging, setIsDragging] = useState(false);

  // Gesture bookkeeping lives in refs: it changes on every pointermove and
  // must not drive a re-render of its own.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pinchDistance: number;
    pinchScale: number;
    moved: number;
  } | null>(null);

  const contentRef = useRef(content);
  contentRef.current = content;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const clampTransform = useCallback((next: ViewTransform): ViewTransform => {
    const size = contentRef.current;
    const view = viewportRef.current;
    if (!size || view.width === 0) return next;

    const scaledWidth = size.width * next.k;
    const scaledHeight = size.height * next.k;

    // Allow the content to be dragged off-screen only until a sliver remains,
    // so it can never be lost entirely.
    const x = clampBetween(next.x, view.width - scaledWidth - KEEP_VISIBLE, KEEP_VISIBLE);
    const y =
      axis === 'x'
        ? next.y
        : clampBetween(next.y, view.height - scaledHeight - KEEP_VISIBLE, KEEP_VISIBLE);

    return { ...next, x, y };
  }, [axis]);

  const setTransform = useCallback(
    (next: ViewTransform) => setTransformState(clampTransform(next)),
    [clampTransform],
  );

  // Track the element's size so fit-to-view and centring have real numbers.
  useLayoutEffect(() => {
    if (!element) {
      setViewport({ width: 0, height: 0 });
      return;
    }

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport((current) =>
        current.width === rect.width && current.height === rect.height
          ? // Same size: keep the identity so effects keyed on `viewport` do
            // not re-run on every observer callback.
            current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  /** Zoom about a fixed screen point so the content under it stays put. */
  const zoomAt = useCallback(
    (factor: number, screenX: number, screenY: number) => {
      if (!zoomable) return;
      setTransformState((current) => {
        const k = clamp(current.k * factor, minScale, maxScale);
        if (k === current.k) return current;
        const ratio = k / current.k;
        return clampTransform({
          x: screenX - (screenX - current.x) * ratio,
          y: screenY - (screenY - current.y) * ratio,
          k,
        });
      });
    },
    [clampTransform, maxScale, minScale, zoomable],
  );

  const zoomBy = useCallback(
    (factor: number) => zoomAt(factor, viewport.width / 2, viewport.height / 2),
    [viewport.height, viewport.width, zoomAt],
  );

  const zoomAtClient = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const rect = nodeRef.current?.getBoundingClientRect();
      zoomAt(factor, clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0));
    },
    [zoomAt],
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    // Let interactive children (buttons, links, cards) handle their own input.
    if ((event.target as HTMLElement).closest('[data-no-pan]')) return;

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Safari occasionally refuses capture mid-gesture; panning still works.
    }

    const points = [...pointers.current.values()];
    const first = points[0];
    const second = points[1];

    setTransformState((current) => {
      gesture.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
        pinchDistance:
          first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
        pinchScale: current.k,
        moved: 0,
      };
      return current;
    });

    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = gesture.current;
      if (!state || !pointers.current.has(event.pointerId)) return;

      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointers.current.values()];

      // Two fingers down: pinch to zoom about the midpoint.
      const first = points[0];
      const second = points[1];
      if (first && second && state.pinchDistance > 0 && zoomable) {
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const rect = nodeRef.current?.getBoundingClientRect();
        const midX = (first.x + second.x) / 2 - (rect?.left ?? 0);
        const midY = (first.y + second.y) / 2 - (rect?.top ?? 0);

        setTransformState((current) => {
          const k = clamp(
            (state.pinchScale * distance) / state.pinchDistance,
            minScale,
            maxScale,
          );
          const ratio = k / current.k;
          return clampTransform({
            x: midX - (midX - current.x) * ratio,
            y: midY - (midY - current.y) * ratio,
            k,
          });
        });
        state.moved = DRAG_THRESHOLD + 1;
        return;
      }

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      state.moved = Math.max(state.moved, Math.abs(dx) + Math.abs(dy));

      setTransformState((current) =>
        clampTransform({
          ...current,
          x: state.originX + dx,
          y: axis === 'x' ? current.y : state.originY + dy,
        }),
      );
    },
    [axis, clampTransform, maxScale, minScale, zoomable],
  );

  const endGesture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
    if (pointers.current.size === 0) setIsDragging(false);
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!zoomable) return;
      const rect = nodeRef.current?.getBoundingClientRect();
      zoomAt(
        event.deltaY < 0 ? 1.12 : 0.89,
        event.clientX - (rect?.left ?? 0),
        event.clientY - (rect?.top ?? 0),
      );
    },
    [zoomAt, zoomable],
  );

  /**
   * The wheel listener has to be non-passive to call preventDefault, and React's
   * onWheel is registered passively — so the page-scroll suppression is bound
   * directly to the node.
   */
  useEffect(() => {
    if (!element || !zoomable) return;
    const block = (event: WheelEvent) => event.preventDefault();
    element.addEventListener('wheel', block, { passive: false });
    return () => element.removeEventListener('wheel', block);
  }, [element, zoomable]);

  const consumedDrag = useCallback(
    () => (gesture.current?.moved ?? 0) > DRAG_THRESHOLD,
    [],
  );

  return {
    containerRef,
    viewport,
    transform,
    setTransform,
    isDragging,
    consumedDrag,
    zoomBy,
    zoomAtClient,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
      onWheel,
    },
  };
}
