import { fetchCarouselItems } from "../services/carouselService.js";

export async function listCarouselItems(req, res) {
  try {
    const city = typeof req.query?.city === "string" ? req.query.city : "";
    const limit = req.query?.limit;
    const data = await fetchCarouselItems({ city, limit });
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("[carouselApi] listCarouselItems error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load carousel" });
  }
}
