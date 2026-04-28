import { DEFAULT_CONTENT, loadCarouselImages, loadSiteContent } from "./firebase.js";

const state = {
  content: DEFAULT_CONTENT,
  carouselIndex: 0,
  carouselTimer: null,
  statsAnimated: false,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    state.content = await loadSiteContent();
  } catch (error) {
    console.warn("Using fallback content:", error);
    state.content = DEFAULT_CONTENT;
  }

  renderSite(state.content);
  initRevealAnimation();
  initStatsAnimation();

  try {
    const images = await loadCarouselImages();
    renderCarousel(images);
  } catch (error) {
    console.warn("Using fallback carousel frames:", error);
    renderCarousel([]);
  }
}

function renderSite(content) {
  renderHero(content.hero);
  renderStats(content.stats);
  renderCarouselText(content.carousel);
  renderFeatured(content.featured);
  renderTools(content.tools);
  renderAbout(content.about);
  renderTimeline(content.timeline, content.journey);
  renderContact(content.hero, content.contact);
}

function renderHero(hero) {
  const brand = document.querySelector("[data-brand]");
  const firstName = document.querySelector("[data-name-first]");
  const lastName = document.querySelector("[data-name-last]");
  const role = document.querySelector("[data-hero-role]");
  const subtitle = document.querySelector("[data-hero-subtitle]");
  const availability = document.querySelector("[data-hero-availability]");
  const profileImage = document.querySelector("#profileImage");
  const profileFrame = document.querySelector("#profileFrame");
  const profileCaption = document.querySelector("[data-profile-caption]");

  if (brand) {
    const label = hero.brand ?? "";
    const cleanLabel = label.trim().replace(/\.$/, "");
    brand.classList.toggle("brand-empty", !cleanLabel);
    brand.innerHTML = cleanLabel ? `${escapeHtml(cleanLabel)}<span>.</span>` : "";
    brand.setAttribute("aria-label", cleanLabel ? `${cleanLabel} home` : "Home");
  }

  setText(firstName, hero.firstName || "Arron");
  setText(lastName, hero.lastName || "Aperocho");
  setText(role, hero.role || "Filmmaker & Video Editor");
  setText(subtitle, hero.subtitle || DEFAULT_CONTENT.hero.subtitle);
  setText(availability, hero.availability || "Available for projects");
  setText(profileCaption, hero.profileCaption || hero.role || "Filmmaker & Video Editor");

  if (hero.profileImage) {
    profileImage.src = hero.profileImage;
    profileImage.hidden = false;
    profileFrame.classList.add("has-image");
  } else {
    profileImage.removeAttribute("src");
    profileImage.hidden = true;
    profileFrame.classList.remove("has-image");
  }

  document.querySelectorAll("[data-email-link]").forEach((link) => {
    link.href = `mailto:${hero.email || DEFAULT_CONTENT.hero.email}`;
  });
}

function renderStats(stats) {
  const statsGrid = document.querySelector("#statsGrid");
  if (!statsGrid) return;

  statsGrid.innerHTML = "";

  stats.forEach((stat) => {
    const tag = stat.link ? "a" : "article";
    const card = document.createElement(tag);
    card.className = "stat-card interactive-card";

    if (stat.link) {
      card.href = stat.link;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", `${stat.label}: open awards folder`);
    }

    card.innerHTML = `
      <strong><span data-count="${Number(stat.value) || 0}">0</span>${escapeHtml(stat.suffix || "")}</strong>
      <span>${escapeHtml(stat.label || "")}</span>
    `;

    statsGrid.appendChild(card);
  });
}

function renderFeatured(featured) {
  const grid = document.querySelector("#featuredGrid");
  setText(document.querySelector("[data-featured-heading]"), featured.heading);
  setText(document.querySelector("[data-featured-subtitle]"), featured.subtitle);

  if (!grid) return;
  grid.innerHTML = "";

  featured.cards.forEach((card) => {
    const link = document.createElement("a");
    link.href = card.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = `feature-card feature-${card.theme || "violet"} interactive-card reveal`;
    link.innerHTML = `
      <div class="feature-icon">${featureIcon(card.icon)}</div>
      <span class="collection-pill">View Collection</span>
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.description)}</p>
      <span class="drive-link">
        Open on Google Drive
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 5h5v5" />
          <path d="M19 5 10 14" />
          <path d="M19 14v5H5V5h5" />
        </svg>
      </span>
    `;
    grid.appendChild(link);
  });
}

function renderTools(tools = []) {
  const section = document.querySelector("#tools");
  const grid = document.querySelector("#toolsGrid");
  if (!section || !grid) return;

  const visibleTools = tools.filter((tool) => tool.iconUrl);
  section.hidden = !visibleTools.length;
  grid.innerHTML = "";

  visibleTools.forEach((tool) => {
    const item = document.createElement(tool.link ? "a" : "div");
    item.className = "tool-logo custom-tool";
    item.setAttribute("aria-label", tool.name || "Creative app");
    item.title = tool.name || "Creative app";

    if (tool.link) {
      item.href = tool.link;
      item.target = "_blank";
      item.rel = "noopener noreferrer";
    }

    item.innerHTML = `<img src="${escapeAttribute(tool.iconUrl)}" alt="${escapeAttribute(tool.name || "Creative app")}" loading="lazy" />`;
    grid.appendChild(item);
  });
}

function renderAbout(about) {
  setText(document.querySelector("[data-about-heading]"), about.heading);

  const paragraphs = document.querySelector("#aboutParagraphs");
  const skills = document.querySelector("#skillCloud");

  if (paragraphs) {
    paragraphs.innerHTML = "";
    about.paragraphs.forEach((paragraph) => {
      const p = document.createElement("p");
      p.textContent = paragraph;
      paragraphs.appendChild(p);
    });
  }

  if (skills) {
    skills.innerHTML = "";
    about.skills.forEach((skill) => {
      const chip = document.createElement("span");
      chip.textContent = skill;
      skills.appendChild(chip);
    });
  }
}

function renderTimeline(items, journey = {}) {
  const timeline = document.querySelector("#timeline");
  setText(document.querySelector("#journeyTitle"), journey.heading || "Journey");
  if (!timeline) return;

  timeline.innerHTML = "";
  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "timeline-item";
    row.innerHTML = `
      <span class="timeline-dot" aria-hidden="true"></span>
      <div>
        <p class="timeline-year">${escapeHtml(item.year)}</p>
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.description)}</p>
      </div>
    `;
    timeline.appendChild(row);
  });
}

function renderContact(hero, contact) {
  setText(document.querySelector("[data-contact-heading]"), contact.heading);
  setText(document.querySelector("[data-contact-copy]"), contact.copy);
  setText(document.querySelector("[data-email-text]"), hero.email);
}

function renderCarouselText(carousel = {}) {
  setText(document.querySelector("[data-carousel-heading]"), carousel.heading || "Work Highlights");
}

function renderCarousel(images) {
  const track = document.querySelector("#carouselTrack");
  const controls = document.querySelector(".carousel-controls");
  if (!track) return;

  const frames = images?.length ? images : fallbackFrames();
  track.innerHTML = "";
  track.classList.remove("is-empty");
  if (controls) controls.hidden = false;

  frames.forEach((image) => {
    const slide = document.createElement("figure");
    slide.className = "carousel-slide";
    slide.innerHTML = `
      <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || image.name || "Portfolio frame")}" loading="lazy" />
    `;
    track.appendChild(slide);
  });

  initCarouselControls();
}

function initCarouselControls() {
  const viewport = document.querySelector("#carouselViewport");
  const track = document.querySelector("#carouselTrack");
  const prev = document.querySelector("#carouselPrev");
  const next = document.querySelector("#carouselNext");
  const slides = Array.from(track.children);

  if (!viewport || !track || !slides.length) return;

  const move = (direction) => {
    const maxIndex = Math.max(0, slides.length - visibleSlides());
    state.carouselIndex += direction;

    if (state.carouselIndex > maxIndex) state.carouselIndex = 0;
    if (state.carouselIndex < 0) state.carouselIndex = maxIndex;

    updateCarouselPosition();
  };

  prev?.addEventListener("click", () => {
    move(-1);
    restartCarouselTimer(move);
  });

  next?.addEventListener("click", () => {
    move(1);
    restartCarouselTimer(move);
  });

  viewport.addEventListener("mouseenter", stopCarouselTimer);
  viewport.addEventListener("mouseleave", () => startCarouselTimer(move));
  window.addEventListener("resize", updateCarouselPosition);

  state.carouselIndex = 0;
  updateCarouselPosition();
  startCarouselTimer(move);
}

function startCarouselTimer(move) {
  stopCarouselTimer();
  state.carouselTimer = window.setInterval(() => move(1), 3600);
}

function stopCarouselTimer() {
  if (state.carouselTimer) {
    window.clearInterval(state.carouselTimer);
  }
}

function restartCarouselTimer(move) {
  stopCarouselTimer();
  startCarouselTimer(move);
}

function updateCarouselPosition() {
  const track = document.querySelector("#carouselTrack");
  const firstSlide = track?.querySelector(".carousel-slide");
  if (!track || !firstSlide) return;

  const gap = Number.parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
  const step = firstSlide.getBoundingClientRect().width + gap;
  track.style.transform = `translate3d(${-state.carouselIndex * step}px, 0, 0)`;
}

function visibleSlides() {
  const viewport = document.querySelector("#carouselViewport");
  const firstSlide = document.querySelector(".carousel-slide");
  if (!viewport || !firstSlide) return 1;

  return Math.max(1, Math.floor(viewport.getBoundingClientRect().width / firstSlide.getBoundingClientRect().width));
}

function initStatsAnimation() {
  const statsGrid = document.querySelector("#statsGrid");
  if (!statsGrid) return;

  const animate = () => {
    if (state.statsAnimated) return;
    state.statsAnimated = true;
    document.querySelectorAll("[data-count]").forEach((node) => animateNumber(node));
  };

  if (!("IntersectionObserver" in window)) {
    animate();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        animate();
        observer.disconnect();
      }
    },
    { threshold: 0.35 }
  );

  observer.observe(statsGrid);
}

function animateNumber(node) {
  const target = Number(node.dataset.count) || 0;
  const duration = 1300;
  const start = performance.now();

  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = Math.round(target * eased);

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      node.textContent = target;
    }
  };

  requestAnimationFrame(tick);
}

function initRevealAnimation() {
  const elements = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  elements.forEach((element) => observer.observe(element));
}

function featureIcon(type) {
  const icons = {
    palette: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 8C18.8 8 8 17.8 8 30.3 8 41.7 17.5 51 28.8 51h4.7c2.1 0 3.3-2.4 2.1-4.1-.8-1.1-.1-2.7 1.3-2.7h4.7C49.6 44.2 56 37.7 56 29.7 56 17.7 45.6 8 32 8z" />
        <circle cx="22" cy="27" r="4" />
        <circle cx="31" cy="20" r="4" />
        <circle cx="42" cy="25" r="4" />
        <circle cx="28" cy="36" r="4" />
      </svg>`,
    clapper: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M13 26h38v27H13z" />
        <path d="m14 26 36-11 3 10-36 11z" />
        <path d="m24 23 8 9" />
        <path d="m38 19 8 9" />
        <path d="M13 36h38" />
      </svg>`,
    film: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M16 15h32v34H16z" />
        <path d="M22 15v34M42 15v34M16 25h32M16 39h32" />
        <path d="M11 20h5M11 30h5M11 40h5M48 20h5M48 30h5M48 40h5" />
      </svg>`,
  };

  return icons[type] || icons.film;
}

function fallbackFrames() {
  return [
    makePortraitFrame("#111827", "#e9d5ff", "#fb7185", 1),
    makePortraitFrame("#172033", "#bfdbfe", "#38bdf8", 2),
    makePortraitFrame("#1f2937", "#fde68a", "#f97316", 3),
    makePortraitFrame("#14151b", "#fecdd3", "#a78bfa", 4),
    makePortraitFrame("#0f172a", "#bbf7d0", "#22c55e", 5),
  ];
}

function makePortraitFrame(base, wash, accent, seed) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${wash}"/>
          <stop offset="0.62" stop-color="${accent}"/>
          <stop offset="1" stop-color="${base}"/>
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="${base}"/>
      <rect x="64" y="76" width="772" height="1048" rx="64" fill="url(#g)" opacity=".88"/>
      <circle cx="${seed % 2 ? 220 : 690}" cy="${seed % 2 ? 940 : 230}" r="290" fill="${base}" opacity=".28"/>
      <circle cx="${seed % 2 ? 710 : 180}" cy="${seed % 2 ? 220 : 900}" r="230" fill="white" opacity=".16"/>
      <path d="M150 820c150-130 280-118 410-250 78-78 168-120 250-118" fill="none" stroke="white" stroke-width="24" opacity=".26"/>
    </svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    alt: "Portrait work highlight",
  };
}

function setText(node, value) {
  if (node && value !== undefined) {
    node.textContent = value;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[character];
  });
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
