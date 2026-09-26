import { useEffect, useRef } from 'react';

/**
 * Decorative custom cursor (outer ring + inner dot, hover/click
 * reactions). Ported from a vanilla-JS snippet — the one real change
 * from the original is using event delegation (mouseover/mouseout on
 * document, checking e.target.closest(...)) instead of attaching
 * listeners to a fixed list of elements once at setup time. This app
 * is a single-page app whose buttons/links change on every
 * navigation, so the original "select all hoverable elements once"
 * approach would stop working for anything rendered after the first
 * page load.
 */
export default function CustomCursor() {
  const outerRef = useRef(null);
  const innerRef = useRef(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let outerX = targetX;
    let outerY = targetY;
    let rafId;

    function onMouseMove(e) {
      targetX = e.clientX;
      targetY = e.clientY;
      inner.style.left = `${targetX}px`;
      inner.style.top = `${targetY}px`;
      document.body.classList.remove('cursor-hidden');
    }
    function onMouseLeaveWindow() {
      document.body.classList.add('cursor-hidden');
    }
    function render() {
      outerX += (targetX - outerX) * 0.18;
      outerY += (targetY - outerY) * 0.18;
      outer.style.left = `${outerX}px`;
      outer.style.top = `${outerY}px`;
      rafId = requestAnimationFrame(render);
    }
    function onMouseOver(e) {
      if (e.target.closest?.('a, button, [data-cursor-hover]')) {
        document.body.classList.add('cursor-hover');
      }
    }
    function onMouseOut(e) {
      if (e.target.closest?.('a, button, [data-cursor-hover]')) {
        document.body.classList.remove('cursor-hover');
      }
    }
    function onMouseDown(e) {
      document.body.classList.add('cursor-active');
      const ripple = document.createElement('div');
      ripple.className = 'cursor-ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    }
    function onMouseUp() {
      document.body.classList.remove('cursor-active');
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeaveWindow);
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    rafId = requestAnimationFrame(render);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeaveWindow);
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      cancelAnimationFrame(rafId);
      document.body.classList.remove('cursor-hover', 'cursor-active', 'cursor-hidden');
    };
  }, []);

  return (
    <>
      <div className="cursor-outer" ref={outerRef} />
      <div className="cursor-inner" ref={innerRef} />
    </>
  );
}
