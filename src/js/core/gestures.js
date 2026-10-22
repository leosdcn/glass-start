/**
 * 指针高光与卡片 3D 倾斜，使用 requestAnimationFrame 合并更新。
 */
import { CONFIG } from '../config/constants.js';
import { state } from '../state/store.js';

let isGlassSpotlightAndTiltInitialized = false;

/** @type {HTMLElement | null} */
let activeCard = null;
/** @type {DOMRect | null} */
let activeCardRect = null;
/** @type {number | null} */
let rafId = null;
/** @type {MouseEvent | PointerEvent | null} */
let pendingEvent = null;

export function resetActiveCard() {
    pendingEvent = null;
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (activeCard) {
        activeCard.style.transition = '';
        activeCard.style.transform = '';
        activeCard.style.willChange = '';
        activeCard = null;
        activeCardRect = null;
    }
}
export function initGlassSpotlightAndTilt() {
    if (typeof window === 'undefined') return;
    if (isGlassSpotlightAndTiltInitialized) return;

    const mediaHover = window.matchMedia && window.matchMedia('(hover: hover)');
    const mediaMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!mediaHover || !mediaHover.matches) return;
    isGlassSpotlightAndTiltInitialized = true;

    const canAnimate = () => mediaHover.matches && !mediaMotion?.matches && !document.hidden
        && !document.body.classList.contains('tab-blurred')
        && !document.body.classList.contains('is-screen-transitioning') && state.currentSection === 'nav';

    if (mediaMotion && mediaMotion.addEventListener) {
        mediaMotion.addEventListener('change', (e) => {
            if (e.matches) resetActiveCard();
        });
    }

    function updateCardTransform() {
        if (!canAnimate()) {
            resetActiveCard();
            return;
        }
        if (!activeCard || !pendingEvent) {
            rafId = null;
            return;
        }
        if (!activeCardRect) activeCardRect = activeCard.getBoundingClientRect();
        const rect = activeCardRect;
        const x = pendingEvent.clientX - rect.left;
        const y = pendingEvent.clientY - rect.top;

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        // 光斑纹理固定在卡片中心，更新位移而不是重绘渐变背景。
        activeCard.style.setProperty('--mouse-x', `${x - centerX}px`);
        activeCard.style.setProperty('--mouse-y', `${y - centerY}px`);
        const maxDeg = CONFIG.PHYSICS.TILT_MAX_ROTATION_DEG;
        const rotateX = -((y - centerY) / centerY) * maxDeg;
        const rotateY = ((x - centerX) / centerX) * maxDeg;

        const isPressed = (typeof activeCard.matches === 'function' && activeCard.matches(':active')) || (pendingEvent.buttons === 1);
        const targetScale = isPressed ? CONFIG.PHYSICS.TILT_PRESSED_SCALE : CONFIG.PHYSICS.TILT_HOVER_SCALE;

        activeCard.style.transform = `perspective(${CONFIG.PHYSICS.TILT_PERSPECTIVE_PX}px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(${targetScale})`;
        rafId = null;
    }

    /**
     * @param {HTMLElement} card
     * @param {MouseEvent | PointerEvent} e
     */
    function setActiveCardAndSchedule(card, e) {
        if (!canAnimate()) {
            resetActiveCard();
            return;
        }
        if (activeCard !== card) {
            if (activeCard) resetActiveCard();
            activeCard = card;
            activeCardRect = card.getBoundingClientRect();
            activeCard.style.willChange = 'transform';
            const tiltSec = `${CONFIG.TIMERS.TILT_TRANSITION_MS / 1000}s`;
            const bgSec = `${CONFIG.TIMERS.TILT_BG_TRANSITION_MS / 1000}s`;
            activeCard.style.transition = `transform ${tiltSec} ease-out, background-color ${bgSec} ease, border-color ${bgSec} ease, box-shadow var(--duration-tactile) var(--ease-tactile)`;
        }
        pendingEvent = e;
        if (rafId === null) {
            rafId = requestAnimationFrame(updateCardTransform);
        }
    }

    document.addEventListener('pointerdown', (e) => {
        if (typeof state !== 'undefined' && state.currentSection !== 'nav') return;
        const targetEl = e.target instanceof Element ? e.target : null;
        const card = /** @type {HTMLElement|null} */ (targetEl?.closest?.('.nav-bookmark'));
        if (card) {
            setActiveCardAndSchedule(card, e);
        }
    }, { passive: true });

    document.addEventListener('pointerup', (e) => {
        if (activeCard) {
            pendingEvent = e;
            if (rafId === null) {
                rafId = requestAnimationFrame(updateCardTransform);
            }
        }
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
        if (!activeCard && typeof state !== 'undefined' && state.currentSection !== 'nav') return;
        const targetEl = e.target instanceof Element ? e.target : null;
        const card = /** @type {HTMLElement|null} */ (targetEl?.closest?.('.nav-bookmark'));
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
        const targetEl = e.target instanceof Element ? e.target : null;
        const validDragTarget = targetEl && targetEl.closest && targetEl.closest('.edit-row-card[draggable="true"], .drag-handle');
        if (!validDragTarget) {
            e.preventDefault();
        }
        resetActiveCard();
    }, { capture: true });

    window.addEventListener('blur', () => { resetActiveCard(); }, { passive: true });
    window.addEventListener('resize', () => { resetActiveCard(); }, { passive: true });
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
