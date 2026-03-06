import express from "express";
import pool from "../Backend/db/pg.js";
import { sendNudgeEmail } from "../kindnessEmailer.js";
import { ensureAdmin } from "../Backend/middleware/ensureAdmin.js";

const orgApplyRouter = express.Router();

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect("/login");
}

async function resolveUserId(req) {
  if (req.user?.id) return Number(req.user.id);
  if (req.user?.user_id) return Number(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) throw new Error("User record not found.");
  return Number(rows[0].id);
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function appBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req?.protocol || "http";
  const host = req?.get?.("x-forwarded-host") || req?.get?.("host");
  if (host) return `${protocol}://${host}`;
  const port = process.env.PORT ? Number(process.env.PORT) : 5001;
  return `http://localhost:${port}`;
}

orgApplyRouter.get("/org-apply", ensureAuthenticated, async (req, res) => {
  try {
    if (req.user?.org_rep) return res.redirect("/org-portal");
    const assetTag = Date.now();
    const submitted = req.query.submitted === "true";
    const error = req.query.error === "true";
    const csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : "";
    return res.render("org-apply", { user: req.user, assetTag, submitted, error, csrfToken });
  } catch (err) {
    console.error("GET /org-apply error:", err);
    return res.redirect("/org-apply?error=true");
  }
});

orgApplyRouter.post("/org-apply", ensureAuthenticated, async (req, res) => {
  try {
    const userId = await resolveUserId(req);
    const orgNameRaw = req.body?.orgName;
    const orgName = String(orgNameRaw || "").trim();
    const orgDescription = String(req.body?.orgDescription || "").trim() || null;
    const orgWebsite = String(req.body?.orgWebsite || "").trim() || null;
    const repRole = String(req.body?.repRole || "").trim() || null;

    if (!orgName || orgName.length > 255) {
      return res.status(400).send("orgName is required and must be 255 characters or less.");
    }

    await pool.query(
      `
        INSERT INTO org_applications
          (user_id, org_name, org_description, org_website, rep_role, status)
        VALUES
          ($1, $2, $3, $4, $5, 'pending')
      `,
      [userId, orgName, orgDescription, orgWebsite, repRole]
    );

    const adminEmails = getAdminEmails();
    const reviewUrl = `${appBaseUrl(req)}/admin/org-applications`;
    const applicantName = `${req.user?.firstname || ""} ${req.user?.lastname || ""}`.trim() || "Unknown";
    const applicantEmail = req.user?.email || "";
    const textBody = [
      `Name: ${applicantName}`,
      `Email: ${applicantEmail}`,
      `Org: ${orgName}`,
      `Role: ${repRole || ""}`,
      `Website: ${orgWebsite || ""}`,
      `Description: ${orgDescription || ""}`,
      `Review at: ${reviewUrl}`,
    ].join("\n");

    await Promise.all(
      adminEmails.map((to) =>
        sendNudgeEmail({
          to,
          subject: `New Org Rep Application — ${orgName}`,
          text: textBody,
        })
      )
    );

    return res.redirect("/org-apply?submitted=true");
  } catch (err) {
    console.error("POST /org-apply error:", err);
    return res.redirect("/org-apply?error=true");
  }
});

orgApplyRouter.get("/admin/org-applications", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { rows: applications } = await pool.query(
      `
        SELECT
          oa.id,
          oa.user_id,
          oa.org_name,
          oa.org_description,
          oa.org_website,
          oa.rep_role,
          oa.status,
          oa.submitted_at,
          u.firstname,
          u.lastname,
          u.email
        FROM org_applications oa
        JOIN userdata u ON u.id = oa.user_id
        WHERE oa.status = 'pending'
        ORDER BY oa.submitted_at ASC
      `
    );

    return res.render("admin-org-applications", {
      applications,
      user: req.user,
      assetTag: Date.now(),
      csrfToken: typeof req.csrfToken === "function" ? req.csrfToken() : "",
    });
  } catch (err) {
    console.error("GET /admin/org-applications error:", err);
    return res.status(500).send("Unable to load applications.");
  }
});

orgApplyRouter.post("/admin/org-applications/:id/approve", ensureAuthenticated, ensureAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const applicationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({ success: false, error: "invalid id" });
    }

    const { rows: [application] } = await client.query(
      `
        SELECT
          oa.*,
          u.firstname,
          u.lastname,
          u.email
        FROM org_applications oa
        JOIN userdata u ON u.id = oa.user_id
        WHERE oa.id = $1
        LIMIT 1
      `,
      [applicationId]
    );

    if (!application) return res.status(404).json({ success: false, error: "not found" });
    if (String(application.status) !== "pending") {
      return res.status(400).json({ success: false, error: "application not pending" });
    }

    await client.query("BEGIN");

    const { rows: [organization] } = await client.query(
      `
        INSERT INTO organizations
          (name, description, website, rep_user_id, rep_role, status, approved_at, approved_by)
        VALUES
          ($1, $2, $3, $4, $5, 'approved', NOW(), $6)
        RETURNING id
      `,
      [
        application.org_name,
        application.org_description,
        application.org_website,
        application.user_id,
        application.rep_role,
        req.user?.email || "",
      ]
    );

    const approvedOrgId = Number(organization.id);

    await client.query(
      `
        UPDATE userdata
        SET org_rep = true,
            org_id = $1
        WHERE id = $2
      `,
      [approvedOrgId, application.user_id]
    );

    await client.query(
      `
        UPDATE org_applications
        SET status = 'approved',
            reviewed_at = NOW(),
            reviewed_by = $1
        WHERE id = $2
      `,
      [req.user?.email || "", applicationId]
    );

    await client.query("COMMIT");

    const baseUrl = appBaseUrl(req);
    await sendNudgeEmail({
      to: application.email,
      subject: "You're approved as an Organization Representative on GetKinder!",
      text: `Hi ${application.firstname || "there"}, your organization ${application.org_name} has been approved.\nYou can now access the Organization Portal at ${baseUrl}/org-portal.\nWelcome aboard! — The GetKinder Team`,
    });

    return res.json({ success: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("POST /admin/org-applications/:id/approve error:", err);
    return res.status(500).json({ success: false, error: "approval failed" });
  } finally {
    client.release();
  }
});

orgApplyRouter.post("/admin/org-applications/:id/decline", ensureAuthenticated, ensureAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const applicationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({ success: false, error: "invalid id" });
    }

    const { rows: [application] } = await client.query(
      `
        SELECT
          oa.id,
          oa.status,
          oa.org_name,
          u.firstname,
          u.email
        FROM org_applications oa
        JOIN userdata u ON u.id = oa.user_id
        WHERE oa.id = $1
        LIMIT 1
      `,
      [applicationId]
    );

    if (!application) return res.status(404).json({ success: false, error: "not found" });

    await client.query(
      `
        UPDATE org_applications
        SET status = 'declined',
            reviewed_at = NOW(),
            reviewed_by = $1
        WHERE id = $2
      `,
      [req.user?.email || "", applicationId]
    );

    await sendNudgeEmail({
      to: application.email,
      subject: "Update on your GetKinder organization application",
      text: `Hi ${application.firstname || "there"}, thank you for applying on behalf of ${application.org_name}.\nAt this time we are unable to approve this request.\nYou're welcome to apply again with more details. — The GetKinder Team`,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /admin/org-applications/:id/decline error:", err);
    return res.status(500).json({ success: false, error: "decline failed" });
  } finally {
    client.release();
  }
});

export default orgApplyRouter;
