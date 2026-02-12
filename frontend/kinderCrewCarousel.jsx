import React, { useEffect, useMemo, useRef, useState } from "react";

const BRAND_VARS = `
  :root { --ink:#455a7c; --coral:#ff5656; --mist:#b5bdcb; --canvas:#f4f4f4; }
`;

const PLACEHOLDER_COUNT = 4;
const SCROLL_AMOUNT = 280;

function buildUrl(base, params) {
  const url = new URL(base, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    url.searchParams.set(k, v);
  });
  return url.toString().replace(window.location.origin, "");
}

function clampItems(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

export default function KinderCrewCarousel(props = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollerRef = useRef(null);
  const abortRef = useRef(null);

  const city = typeof props.city === "string" ? props.city : "";
  const limit = Number.isFinite(props.limit) ? props.limit : 20;

  const evaluateScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  };

  const fetchData = () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const url = buildUrl("/api/carousel", { city: city || undefined, limit });
    setLoading(true);
    setError(null);
    fetch(url, { credentials: "include", signal: controller.signal })
      .then((res) => res.json().catch(() => ({})).then((json) => ({ ok: res.ok, json })))
      .then((payload) => {
        if (!payload?.ok) throw new Error(payload?.json?.error || "Failed to load carousel");
        setItems(clampItems(payload?.json?.data));
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Unable to load carousel");
      })
      .finally(() => {
        setLoading(false);
        setTimeout(evaluateScroll, 0);
      });
  };

  useEffect(() => {
    fetchData();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [city, limit]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    evaluateScroll();
    const onScroll = () => evaluateScroll();
    const onResize = () => evaluateScroll();
    el.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [items]);

  const hasItems = useMemo(() => (items || []).length > 0, [items]);

  const handleNav = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  const content = (() => {
    if (loading) return <SkeletonRow />;
    if (error)
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchData}
            className="text-[var(--ink)] font-semibold text-xs underline"
          >
            Retry
          </button>
        </div>
      );
    if (!hasItems)
      return (
        <div className="flex items-center justify-between bg-white border border-dashed border-slate-200 rounded-xl p-4">
          <div>
            <p className="text-sm text-slate-700">No posts yet — check back soon.</p>
            <p className="text-xs text-slate-500">Browse opportunities while your crew shares updates.</p>
          </div>
          <a
            href="/events"
            className="inline-flex items-center px-3 py-2 rounded-lg text-white text-sm font-semibold hover:opacity-90"
            style={{ backgroundColor: "var(--coral)" }}
            data-testid="carousel-browse-opportunities"
          >
            Browse opportunities
          </a>
        </div>
      );
    return (
      <div className="relative">
        <button
          type="button"
          aria-label="Scroll carousel left"
          className="absolute left-0 top-1/2 -translate-y-1/2 bg-white border border-slate-200 shadow-sm rounded-full p-2 text-[var(--ink)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]"
          onClick={() => handleNav("left")}
          disabled={!canScrollLeft}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Scroll carousel right"
          className="absolute right-0 top-1/2 -translate-y-1/2 bg-white border border-slate-200 shadow-sm rounded-full p-2 text-[var(--ink)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]"
          onClick={() => handleNav("right")}
          disabled={!canScrollRight}
        >
          ›
        </button>
        <div
          className="overflow-x-auto"
          ref={scrollerRef}
          aria-label="Kinder Crew updates"
        >
          <div
            className="flex gap-3 pb-2 snap-x snap-mandatory"
            data-testid="kinder-crew-carousel"
          >
            {items.map((item) => (
              <CarouselCard key={item?.id || item?.seed_key || Math.random().toString(36)} item={item} />
            ))}
            <BrowseCard />
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div className="mb-4">
      <style>{BRAND_VARS}</style>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl md:text-2xl font-semibold text-[var(--ink)]">
          From your Kinder Crew this week
        </h2>
        {city ? <span className="text-xs text-slate-500">City: {city}</span> : null}
      </div>
      {content}
    </div>
  );
}

function CarouselCard({ item }) {
  const title = item?.title || item?.caption || "Crew update";
  const caption = typeof item?.caption === "string" ? item.caption : "";
  const author = item?.author_name;
  const cityTag = item?.city;
  const mediaUrl = item?.media_url;

  return (
    <article
      className="snap-start shrink-0 w-64 md:w-72 h-80 md:h-80 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden grid focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]"
      style={{
        gridTemplateRows: "176px 1fr",
      }}
      tabIndex={0}
      data-testid="carousel-card"
      aria-label={title}
    >
      <div
        className="relative w-full bg-slate-100 overflow-hidden"
        style={{ height: "100%" }}
      >
        {mediaUrl ? (
          <img
            src={mediaUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover object-center block"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-slate-400 text-sm">
            No image
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 min-h-0">
        <div className="text-sm font-semibold text-[var(--ink)] truncate">
          {title}
        </div>

        {caption ? (
          <p
            className="text-sm text-slate-600"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {caption}
          </p>
        ) : null}

        <div className="mt-auto">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            {author ? <span>{author}</span> : null}
            {cityTag ? (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {cityTag}
              </span>
            ) : null}
          </div>

        </div>
      </div>
    </article>
  );
}

function BrowseCard() {
  return (
    <article
      className="snap-start shrink-0 w-64 md:w-72 h-80 md:h-80 rounded-xl border border-dashed border-slate-300 bg-white/80 shadow-sm p-4 flex flex-col justify-between"
      data-testid="carousel-browse-opportunities"
    >
      <div>
        <p className="text-sm uppercase tracking-wide text-slate-500">Keep Going</p>
        <h3 className="text-lg font-semibold text-[var(--ink)] mt-1">Browse opportunities</h3>
        <p className="text-sm text-slate-600 mt-1">
          Join an upcoming serve and add your own post to the crew feed.
        </p>
      </div>
      <a
        href="/events"
        className="mt-3 inline-flex items-center justify-center px-3 py-2 rounded-lg text-white text-sm font-semibold hover:opacity-90"
        style={{ backgroundColor: "var(--coral)" }}
      >
        View events
      </a>
    </article>
  );
}

function SkeletonRow() {
  return (
    <div className="overflow-x-hidden" aria-label="Loading crew updates">
      <div className="flex gap-3 pb-2">
        {Array.from({ length: PLACEHOLDER_COUNT }).map((_, idx) => (
          <div
            key={idx}
            className="animate-pulse snap-start shrink-0 w-64 md:w-72 h-80 md:h-80 rounded-xl border border-slate-200 bg-white overflow-hidden"
            aria-hidden="true"
          >
            <div className="w-full bg-slate-200" style={{ height: "176px" }} />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-slate-200 rounded" />
              <div className="h-3 bg-slate-200 rounded w-3/4" />
              <div className="h-3 bg-slate-200 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
