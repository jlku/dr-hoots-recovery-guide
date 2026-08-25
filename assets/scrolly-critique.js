const steps = [...document.querySelectorAll(".story-step")];
const panels = [...document.querySelectorAll(".visual-panel")];
const indicators = [...document.querySelectorAll(".step-nav__item")];

function activate(index) {
  steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === index));
  panels.forEach((panel, panelIndex) => panel.classList.toggle("is-active", panelIndex === index));
  indicators.forEach((indicator, indicatorIndex) => {
    if (indicatorIndex === index) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  });
}

if ("IntersectionObserver" in window) {
  const ratios = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => ratios.set(entry.target, entry.intersectionRatio));
    const index = steps.reduce((best, step, stepIndex) => {
      return (ratios.get(step) ?? 0) > (ratios.get(steps[best]) ?? 0) ? stepIndex : best;
    }, 0);
    activate(index);
  }, { rootMargin: "-18% 0px -34% 0px", threshold: [0, .25, .5, .75] });
  steps.forEach((step) => observer.observe(step));
}
