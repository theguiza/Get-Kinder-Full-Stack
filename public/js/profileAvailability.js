(function () {
  'use strict';

  const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_LABELS = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    sun: 'Sun'
  };
  const TIME_OF_DAY_ORDER = ['morning', 'afternoon', 'evening'];
  const TIME_OF_DAY_LABELS = {
    morning: 'mornings',
    afternoon: 'afternoons',
    evening: 'evenings'
  };
  const FREQUENCY_LABELS = {
    '1w': '1x/week',
    '2w': '2x/week',
    flex: 'Flexible'
  };
  const NOTICE_LABELS = {
    same_day: 'Same-day notice',
    '24h': '24h notice',
    '48h': '48h notice'
  };

  function normalizeTime(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : null;
  }

  function normalizeDate(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const date = new Date(trimmed + 'T00:00:00.000Z');
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10) === trimmed ? trimmed : null;
  }

  function isValidTimezone(value) {
    if (typeof value !== 'string') return false;
    const tz = value.trim();
    if (!tz || !/^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch (_) {
      return false;
    }
  }

  function detectBrowserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_) {
      return '';
    }
  }

  function normalizeTimezone(value, fallback) {
    if (isValidTimezone(value)) return String(value).trim();
    if (isValidTimezone(fallback)) return String(fallback).trim();
    return 'America/Vancouver';
  }

  function normalizeWeekly(raw, fallbackTimezone) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const timezone = normalizeTimezone(source.timezone, fallbackTimezone);

    const days = Array.isArray(source.days)
      ? [...new Set(source.days.map((v) => String(v || '').trim().toLowerCase().slice(0, 3)).filter((v) => DAY_ORDER.includes(v)))]
      : [];

    const timeOfDay = Array.isArray(source.time_of_day)
      ? [...new Set(source.time_of_day.map((v) => String(v || '').trim().toLowerCase()).filter((v) => TIME_OF_DAY_ORDER.includes(v)))]
      : [];

    const frequency = Object.prototype.hasOwnProperty.call(FREQUENCY_LABELS, source.frequency)
      ? source.frequency
      : 'flex';
    const notice = Object.prototype.hasOwnProperty.call(NOTICE_LABELS, source.notice)
      ? source.notice
      : '24h';

    let earliest = normalizeTime(source.earliest_time);
    let latest = normalizeTime(source.latest_time);
    if (earliest && latest && earliest >= latest) {
      earliest = null;
      latest = null;
    }

    return {
      days,
      time_of_day: timeOfDay,
      earliest_time: earliest,
      latest_time: latest,
      frequency,
      notice,
      timezone
    };
  }

  function normalizeExceptions(raw, fallbackTimezone) {
    if (!Array.isArray(raw)) return [];
    const items = [];
    const perDateCounts = new Map();

    raw.forEach((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const date = normalizeDate(entry.date);
      const start = normalizeTime(entry.start);
      const end = normalizeTime(entry.end);
      if (!date || !start || !end || start >= end) return;

      const nextForDate = (perDateCounts.get(date) || 0) + 1;
      if (nextForDate > 3 || items.length >= 10) return;

      perDateCounts.set(date, nextForDate);
      items.push({
        date,
        start,
        end,
        timezone: normalizeTimezone(entry.timezone, fallbackTimezone)
      });
    });

    return items.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      return a.end.localeCompare(b.end);
    });
  }

  function formatTimeLabel(time) {
    if (!normalizeTime(time)) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}${period}` : `${hour}:${String(m).padStart(2, '0')}${period}`;
  }

  function formatExceptionChip(item) {
    const dateObj = new Date(item.date + 'T00:00:00');
    const dateLabel = Number.isNaN(dateObj.getTime())
      ? item.date
      : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${dateLabel}, ${formatTimeLabel(item.start)}-${formatTimeLabel(item.end)}`;
  }

  function buildSummary(state) {
    const dayPart = state.weekly.days.length === 0 || state.weekly.days.length === 7
      ? 'Any day'
      : state.weekly.days
          .slice()
          .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
          .map((d) => DAY_LABELS[d])
          .join('/');

    const todPart = state.weekly.time_of_day.length
      ? state.weekly.time_of_day
          .slice()
          .sort((a, b) => TIME_OF_DAY_ORDER.indexOf(a) - TIME_OF_DAY_ORDER.indexOf(b))
          .map((t) => TIME_OF_DAY_LABELS[t])
          .join(' & ')
      : 'any time';

    const freqPart = FREQUENCY_LABELS[state.weekly.frequency] || FREQUENCY_LABELS.flex;
    const noticePart = NOTICE_LABELS[state.weekly.notice] || NOTICE_LABELS['24h'];
    return `${dayPart} ${todPart} • ${freqPart} • ${noticePart}`;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('profile-form');
    const weeklyInput = document.getElementById('availability_weekly_json');
    const exceptionsInput = document.getElementById('availability_exceptions_json');
    const timezoneInput = document.getElementById('availability_timezone');

    if (!form || !weeklyInput || !exceptionsInput || !timezoneInput) return;

    const summaryEl = document.getElementById('availability-summary');
    const timezoneEl = document.getElementById('availability-timezone');
    const daysWrap = document.getElementById('availability-days');
    const todWrap = document.getElementById('availability-time-of-day');
    const frequencySelect = document.getElementById('availability-frequency');
    const noticeSelect = document.getElementById('availability-notice');
    const earliestInput = document.getElementById('availability-earliest');
    const latestInput = document.getElementById('availability-latest');

    const exceptionList = document.getElementById('availability-exception-list');
    const exceptionToggle = document.getElementById('availability-exception-toggle');
    const addExceptionButton = document.getElementById('availability-add-exception-btn');
    const limitNote = document.getElementById('availability-exception-limit-note');

    const modalRoot = document.getElementById('availabilityExceptionModal');
    const modalDate = document.getElementById('availability-exception-date');
    const modalStart = document.getElementById('availability-exception-start');
    const modalEnd = document.getElementById('availability-exception-end');
    const modalError = document.getElementById('availability-exception-error');
    const modalAdd = document.getElementById('availability-exception-add-btn');

    let initial = {};
    const initialEl = document.getElementById('availability-initial');
    if (initialEl) {
      try {
        initial = JSON.parse(initialEl.textContent || '{}');
      } catch (_) {
        initial = {};
      }
    }

    const state = {
      weekly: normalizeWeekly(initial.weekly, normalizeTimezone(initial.timezone, detectBrowserTimezone())),
      exceptions: normalizeExceptions(initial.exceptions, normalizeTimezone(initial.timezone, detectBrowserTimezone())),
      timezone: normalizeTimezone(initial.timezone, detectBrowserTimezone()),
      showAllExceptions: false
    };
    state.weekly.timezone = state.timezone;

    function syncInputs() {
      state.weekly.timezone = state.timezone;
      const exceptionPayload = state.exceptions.map((item) => ({
        date: item.date,
        start: item.start,
        end: item.end,
        timezone: state.timezone
      }));

      weeklyInput.value = JSON.stringify(state.weekly);
      exceptionsInput.value = JSON.stringify(exceptionPayload);
      timezoneInput.value = state.timezone;
    }

    function renderChipStates() {
      if (daysWrap) {
        daysWrap.querySelectorAll('[data-availability-day]').forEach((btn) => {
          const key = btn.getAttribute('data-availability-day');
          const active = state.weekly.days.includes(key);
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }

      if (todWrap) {
        todWrap.querySelectorAll('[data-availability-tod]').forEach((btn) => {
          const key = btn.getAttribute('data-availability-tod');
          const active = state.weekly.time_of_day.includes(key);
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }

      if (frequencySelect) frequencySelect.value = state.weekly.frequency;
      if (noticeSelect) noticeSelect.value = state.weekly.notice;
      if (earliestInput) earliestInput.value = state.weekly.earliest_time || '';
      if (latestInput) latestInput.value = state.weekly.latest_time || '';
      if (summaryEl) summaryEl.textContent = buildSummary(state);
      if (timezoneEl) timezoneEl.textContent = `Timezone: ${state.timezone}`;
    }

    function renderExceptions() {
      if (!exceptionList) return;
      exceptionList.innerHTML = '';

      const visible = state.showAllExceptions ? state.exceptions : state.exceptions.slice(0, 5);
      visible.forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'availability-exception-chip';

        const label = document.createElement('span');
        label.textContent = formatExceptionChip(item);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Remove exception');
        removeBtn.textContent = 'x';
        removeBtn.addEventListener('click', function () {
          const realIndex = state.exceptions.findIndex((candidate) => (
            candidate.date === item.date &&
            candidate.start === item.start &&
            candidate.end === item.end
          ));
          if (realIndex >= 0) {
            state.exceptions.splice(realIndex, 1);
            renderAll();
          }
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        exceptionList.appendChild(chip);
      });

      const hiddenCount = Math.max(0, state.exceptions.length - 5);
      if (exceptionToggle) {
        if (hiddenCount > 0 || state.showAllExceptions) {
          exceptionToggle.classList.remove('d-none');
          exceptionToggle.textContent = state.showAllExceptions ? 'Show fewer' : `+${hiddenCount} more`;
        } else {
          exceptionToggle.classList.add('d-none');
          exceptionToggle.textContent = '';
        }
      }

      const maxed = state.exceptions.length >= 10;
      if (addExceptionButton) addExceptionButton.disabled = maxed;
      if (limitNote) limitNote.classList.toggle('d-none', !maxed);
    }

    function renderAll() {
      renderChipStates();
      renderExceptions();
      syncInputs();
    }

    function showModalError(message) {
      if (!modalError) return;
      modalError.textContent = message;
      modalError.classList.remove('d-none');
    }

    function clearModalError() {
      if (!modalError) return;
      modalError.textContent = '';
      modalError.classList.add('d-none');
    }

    if (daysWrap) {
      daysWrap.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-availability-day]');
        if (!btn) return;
        const day = btn.getAttribute('data-availability-day');
        const index = state.weekly.days.indexOf(day);
        if (index >= 0) state.weekly.days.splice(index, 1);
        else state.weekly.days.push(day);
        state.weekly.days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
        renderAll();
      });
    }

    if (todWrap) {
      todWrap.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-availability-tod]');
        if (!btn) return;
        const value = btn.getAttribute('data-availability-tod');
        const index = state.weekly.time_of_day.indexOf(value);
        if (index >= 0) state.weekly.time_of_day.splice(index, 1);
        else state.weekly.time_of_day.push(value);
        state.weekly.time_of_day.sort((a, b) => TIME_OF_DAY_ORDER.indexOf(a) - TIME_OF_DAY_ORDER.indexOf(b));
        renderAll();
      });
    }

    if (frequencySelect) {
      frequencySelect.addEventListener('change', function () {
        state.weekly.frequency = Object.prototype.hasOwnProperty.call(FREQUENCY_LABELS, frequencySelect.value)
          ? frequencySelect.value
          : 'flex';
        renderAll();
      });
    }

    if (noticeSelect) {
      noticeSelect.addEventListener('change', function () {
        state.weekly.notice = Object.prototype.hasOwnProperty.call(NOTICE_LABELS, noticeSelect.value)
          ? noticeSelect.value
          : '24h';
        renderAll();
      });
    }

    if (earliestInput) {
      earliestInput.addEventListener('change', function () {
        state.weekly.earliest_time = normalizeTime(earliestInput.value);
        if (state.weekly.earliest_time && state.weekly.latest_time && state.weekly.earliest_time >= state.weekly.latest_time) {
          state.weekly.latest_time = null;
          if (latestInput) latestInput.value = '';
        }
        renderAll();
      });
    }

    if (latestInput) {
      latestInput.addEventListener('change', function () {
        state.weekly.latest_time = normalizeTime(latestInput.value);
        if (state.weekly.earliest_time && state.weekly.latest_time && state.weekly.earliest_time >= state.weekly.latest_time) {
          state.weekly.earliest_time = null;
          if (earliestInput) earliestInput.value = '';
        }
        renderAll();
      });
    }

    if (exceptionToggle) {
      exceptionToggle.addEventListener('click', function () {
        state.showAllExceptions = !state.showAllExceptions;
        renderExceptions();
      });
    }

    if (modalRoot) {
      modalRoot.addEventListener('shown.bs.modal', function () {
        clearModalError();
        if (modalDate) modalDate.focus();
      });
    }

    [modalDate, modalStart, modalEnd].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', clearModalError);
    });

    if (modalAdd) {
      modalAdd.addEventListener('click', function () {
        clearModalError();

        if (state.exceptions.length >= 10) {
          showModalError('You can add up to 10 specific date/time exceptions.');
          return;
        }

        const date = normalizeDate(modalDate ? modalDate.value : '');
        const start = normalizeTime(modalStart ? modalStart.value : '');
        const end = normalizeTime(modalEnd ? modalEnd.value : '');

        if (!date) {
          showModalError('Choose a valid date.');
          return;
        }
        if (!start || !end) {
          showModalError('Choose a start and end time.');
          return;
        }
        if (start >= end) {
          showModalError('Start time must be before end time.');
          return;
        }

        const onDateCount = state.exceptions.filter((item) => item.date === date).length;
        if (onDateCount >= 3) {
          showModalError('You can add up to 3 time windows for the same date.');
          return;
        }

        const duplicate = state.exceptions.some((item) => (
          item.date === date && item.start === start && item.end === end
        ));
        if (duplicate) {
          showModalError('That date/time exception already exists.');
          return;
        }

        state.exceptions.push({ date, start, end, timezone: state.timezone });
        state.exceptions.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          if (a.start !== b.start) return a.start.localeCompare(b.start);
          return a.end.localeCompare(b.end);
        });

        if (modalDate) modalDate.value = '';
        if (modalStart) modalStart.value = '';
        if (modalEnd) modalEnd.value = '';

        if (window.bootstrap && window.bootstrap.Modal && modalRoot) {
          const instance = window.bootstrap.Modal.getInstance(modalRoot);
          if (instance) instance.hide();
        }

        renderAll();
      });
    }

    form.addEventListener('submit', function () {
      syncInputs();
    });

    renderAll();
  });
})();
