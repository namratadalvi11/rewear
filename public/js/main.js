/*
 * Front-end behaviour. Everything here is progressive enhancement - every page
 * still works with JavaScript switched off, because all actions are plain forms.
 */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- mobile navigation ------------------------------------- */
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------- theme preference -------------------------------------- */
  const themeToggle = document.querySelector('.theme-toggle');
  const themeIcon = document.querySelector('.theme-icon');
  const applyTheme = (theme) => {
    const dark = theme === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', String(dark));
      themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    if (themeIcon) {
      themeIcon.textContent = dark ? '☀️' : '🌙';
    }
  };

  // ReWear ships a light design only. Ignore the OS dark setting and any old
  // saved preference so pages never show half-dark colours.
  const getPreferredTheme = () => 'light';

  applyTheme(getPreferredTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
      try {
        localStorage.setItem('rewear-theme', next);
      } catch (err) {
        // Ignore storage failures in privacy-restricted browsers.
      }
      applyTheme(next);
    });
    themeToggle.dataset.themeBound = 'true';
  }

  /* ---------- responsive collection filters ------------------------- */
  const collectionFilters = document.querySelector('.collection-filter-wrap');
  if (collectionFilters) {
    const mobileFilters = window.matchMedia('(max-width: 1000px)');
    const syncFilterDisclosure = () => {
      collectionFilters.open = !mobileFilters.matches;
    };
    syncFilterDisclosure();
    mobileFilters.addEventListener('change', syncFilterDisclosure);
  }

  /* ---------- image gallery on the item page ------------------------ */
  const gallery = document.querySelector('.gallery-layout');
  const mainImage = gallery && gallery.querySelector('.gallery-main img');
  const galleryThumbs = gallery ? [...gallery.querySelectorAll('.gallery-thumbs button')] : [];
  if (gallery && mainImage && galleryThumbs.length) {
    let activeImage = 0;
    const count = gallery.querySelector('.gallery-count');
    const showImage = (index) => {
      activeImage = (index + galleryThumbs.length) % galleryThumbs.length;
      mainImage.src = galleryThumbs[activeImage].dataset.src;
      galleryThumbs.forEach((button, i) => button.classList.toggle('on', i === activeImage));
      if (count) count.textContent = `${activeImage + 1} / ${galleryThumbs.length}`;
    };

    galleryThumbs.forEach((button, index) => {
      button.addEventListener('click', () => showImage(index));
    });
    gallery.querySelectorAll('[data-gallery-step]').forEach((button) => {
      button.addEventListener('click', () => {
        showImage(activeImage + Number(button.dataset.galleryStep));
      });
    });
  }

  /* ---------- image preview before uploading ------------------------ */
  const picker = document.querySelector('[data-preview]');
  const previewBox = document.getElementById('preview');
  if (picker && previewBox) {
    picker.addEventListener('change', () => {
      previewBox.innerHTML = '';
      [...picker.files].slice(0, 6).forEach((file) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        img.onload = () => URL.revokeObjectURL(img.src);
        previewBox.appendChild(img);
      });
    });
  }

  /* ---------- listing form: show only the relevant fields ----------- */
  const typeInputs = document.querySelectorAll('[name="listing_type"]');
  function applyListingType() {
    const picked = [...typeInputs].find((i) => i.checked);
    if (!picked) return;
    document.querySelectorAll('[data-for]').forEach((block) => {
      const show = block.dataset.for.split(' ').includes(picked.value);
      block.hidden = !show;
      // Hidden required fields would block submission, so relax them.
      block.querySelectorAll('[data-required]').forEach((f) => { f.required = show; });
    });
  }
  typeInputs.forEach((i) => i.addEventListener('change', applyListingType));
  applyListingType();

  /* ---------- filters: re-submit when a dropdown changes ------------ */
  document.querySelectorAll('[data-autosubmit]').forEach((el) => {
    el.addEventListener('change', () => el.form.submit());
  });

  /* ---------- rental dates: keep the range sensible ---------------- */
  const start = document.querySelector('[data-start]');
  const end = document.querySelector('[data-end]');
  const total = document.getElementById('date-total');
  if (start && end) {
    const sync = () => {
      if (start.value) end.min = start.value;
      if (end.value && end.value < start.value) end.value = start.value;
      if (total && start.value && end.value) {
        const days = Math.round((new Date(end.value) - new Date(start.value)) / 86400000) + 1;
        const perDay = Number(total.dataset.perDay || 0);
        const deposit = Number(total.dataset.deposit || 0);
        total.textContent = `${days} day${days > 1 ? 's' : ''} · rent ₹${(days * perDay)
          .toLocaleString('en-IN')} + ₹${deposit.toLocaleString('en-IN')} refundable deposit`;
      }
    };
    start.addEventListener('change', sync);
    end.addEventListener('change', sync);
    sync();
  }

  /* ---------- confirm before destructive actions ------------------- */
  document.querySelectorAll('[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  /* ---------- star rating input ------------------------------------ */
  document.querySelectorAll('[data-stars]').forEach((group) => {
    const out = group.querySelector('.stars-out');
    group.querySelectorAll('input[type=radio]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (out) out.textContent = '★'.repeat(Number(radio.value))
          + '☆'.repeat(5 - Number(radio.value));
      });
    });
  });
});

/* ---------- homepage header: switch style once the hero scrolls away ---- */
document.addEventListener('DOMContentLoaded', () => {
  const heroNav = document.querySelector('.hero > .nav');
  if (!heroNav) return;
  const update = () => heroNav.classList.toggle('is-scrolled', window.scrollY > 60);
  update();
  window.addEventListener('scroll', update, { passive: true });
});
