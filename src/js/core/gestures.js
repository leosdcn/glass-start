/**
 * ==============================================================================
 * Glass Start — VisionOS 玻璃材质 3D 倾斜与光标折射高光代理 (src/js/core/gestures.js)
 * ==============================================================================
 */
import { CONFIG } from '../config/constants.js';

let isGlassSpotlightAndTiltInitialized = false;

let activeCard = null;
let activeCardRect = null;
let rafId = null;
let pendingEvent = null;

export function resetActiveCard() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (activeCard) {
        activeCard.style.transition = '';
        activeCard.style.transform = '';
        activeCard = null;
        activeCardRect = null;
    }
}
if (typeof window !== 'undefined') {
    window.resetActiveTiltCard = resetActiveCard;
}

export function initGlassSpotlightAndTilt() {
    if (typeof window === 'undefined') return;
    if (isGlassSpotlightAndTiltInitialized) return;

    const mediaHover = window.matchMedia && window.matchMedia('(hover: hover)');
    const mediaMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!mediaHover || !mediaHover.matches) return;
    if (mediaMotion && mediaMotion.matches) return;

    isGlassSpotlightAndTiltInitialized = true;

    if (mediaMotion && mediaMotion.addEventListener) {
        mediaMotion.addEventListener('change', (e) => {
            if (e.matches) resetActiveCard();
        });
    }

    function updateCardTransform() {
        if (!activeCard || !pendingEvent) {
            rafId = null;
            return;
        }
        if (!activeCardRect) activeCardRect = activeCard.getBoundingClientRect();
        const rect = activeCardRect;
        const x = pendingEvent.clientX - rect.left;
        const y = pendingEvent.clientY - rect.top;

        activeCard.style.setProperty('--mouse-x', `${x}px`);
        activeCard.style.setProperty('--mouse-y', `${y}px`);

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const maxDeg = CONFIG.PHYSICS.TILT_MAX_ROTATION_DEG;
        const rotateX = -((y - centerY) / centerY) * maxDeg;
        const rotateY = ((x - centerX) / centerX) * maxDeg;

        const isPressed = (typeof activeCard.matches === 'function' && activeCard.matches(':active')) || (pendingEvent.buttons === 1);
        const targetScale = isPressed ? CONFIG.PHYSICS.TILT_PRESSED_SCALE : CONFIG.PHYSICS.TILT_HOVER_SCALE;

        activeCard.style.transform = `perspective(${CONFIG.PHYSICS.TILT_PERSPECTIVE_PX}px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(${targetScale})`;
        rafId = null;
    }

    function setActiveCardAndSchedule(card, e) {
        if (activeCard !== card) {
            if (activeCard) resetActiveCard();
            activeCard = card;
            activeCardRect = card.getBoundingClientRect();
            const tiltSec = `${CONFIG.TIMERS.TILT_TRANSITION_MS / 1000}s`;
            const bgSec = `${CONFIG.TIMERS.TILT_BG_TRANSITION_MS / 1000}s`;
            activeCard.style.transition = `transform ${tiltSec} ease-out, background-color ${bgSec} ease, border-color ${bgSec} ease, box-shadow var(--duration-tactile) var(--ease-tactile)`;
        }
        pendingEvent = e;
        if (!rafId) {
            rafId = requestAnimationFrame(updateCardTransform);
        }
    }

    document.addEventListener('pointerdown', (e) => {
        const card = e.target?.closest?.('.nav-bookmark');
        if (card) {
            setActiveCardAndSchedule(card, e);
        }
    }, { passive: true });

    document.addEventListener('pointerup', (e) => {
        if (activeCard) {
            pendingEvent = e;
            if (!rafId) {
                rafId = requestAnimationFrame(updateCardTransform);
            }
        }
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
        const card = e.target?.closest?.('.nav-bookmark');
        if (card) {
            setActiveCardAndSchedule(card, e);
        } else if (activeCard) {
            resetActiveCard();
        }
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
        resetActiveCard();
    }, { passive: true });

    window.addEventListener('dragstart', (e) => {
        const validDragTarget = e.target && e.target.closest && e.target.closest('.edit-row-card[draggable="true"], .drag-handle');
        if (!validDragTarget) {
            e.preventDefault();
        }
        resetActiveCard();
    }, { capture: true });

    window.addEventListener('blur', () => { resetActiveCard(); }, { passive: true });
    window.addEventListener('scroll', () => { resetActiveCard(); }, { passive: true, capture: true });
    window.addEventListener('dragend', () => { resetActiveCard(); }, { passive: true });
    window.addEventListener('drop', () => { resetActiveCard(); }, { passive: true });
    window.addEventListener('pointercancel', () => { resetActiveCard(); }, { passive: true });
    window.addEventListener('focus', () => { resetActiveCard(); }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resetActiveCard();
        }
    }, { passive: true });
    window.addEventListener('pageshow', () => {
        resetActiveCard();
    }, { passive: true });
}
