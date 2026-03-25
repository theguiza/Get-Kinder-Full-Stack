export function makeProfileController({
  pool,
  fetchExistingProfileUserRow,
  buildProfileRedirectPath,
  buildProfileFieldUpdates,
  buildProfileRedirectParams,
  resolveProfileSaveAction,
  parseLocationFromRequestBody,
  parseAvailabilityFromRequestBody,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A pg Pool instance is required");
  }
  if (typeof fetchExistingProfileUserRow !== "function") {
    throw new TypeError("fetchExistingProfileUserRow is required");
  }
  if (typeof buildProfileRedirectPath !== "function") {
    throw new TypeError("buildProfileRedirectPath is required");
  }
  if (typeof buildProfileFieldUpdates !== "function") {
    throw new TypeError("buildProfileFieldUpdates is required");
  }
  if (typeof buildProfileRedirectParams !== "function") {
    throw new TypeError("buildProfileRedirectParams is required");
  }
  if (typeof resolveProfileSaveAction !== "function") {
    throw new TypeError("resolveProfileSaveAction is required");
  }
  if (typeof parseLocationFromRequestBody !== "function") {
    throw new TypeError("parseLocationFromRequestBody is required");
  }
  if (typeof parseAvailabilityFromRequestBody !== "function") {
    throw new TypeError("parseAvailabilityFromRequestBody is required");
  }

  return {
    async postPhoto(req, res) {
      try {
        const existingUserRow = await fetchExistingProfileUserRow(req);
        if (!existingUserRow?.id) {
          return res.status(404).send("Profile record not found.");
        }

        if (!req.file) {
          return res.redirect(buildProfileRedirectPath({
            tab: "portfolio",
            uploadError: "noFileSelected"
          }));
        }

        const mimeType = req.file.mimetype;
        const base64str = req.file.buffer.toString("base64");
        const picture = `data:${mimeType};base64,${base64str}`;

        const updateResult = await pool.query(
          `
          UPDATE userdata
             SET picture = $1
           WHERE id = $2
           RETURNING id, picture
          `,
          [picture, existingUserRow.id]
        );
        if (!updateResult.rowCount) {
          return res.status(500).send("Profile photo did not persist.");
        }

        req.user = {
          ...req.user,
          picture,
        };

        return res.redirect(buildProfileRedirectPath(
          buildProfileRedirectParams(resolveProfileSaveAction("save_photo"))
        ));
      } catch (err) {
        console.error("Error updating profile photo:", err);
        return res.status(500).send("Error updating profile photo");
      }
    },

    async postAccount(req, res) {
      try {
        const existingUserRow = await fetchExistingProfileUserRow(req);
        if (!existingUserRow?.id) {
          return res.status(404).send("Profile record not found.");
        }

        const actionState = resolveProfileSaveAction("save_profile");
        const nextFields = buildProfileFieldUpdates({
          actionState,
          body: req.body || {},
          existingUserRow
        });

        const updateResult = await pool.query(
          `
          UPDATE userdata
             SET firstname = $1,
                 lastname  = $2,
                 email     = $3,
                 phone     = $4,
                 address1  = $5,
                 city      = $6,
                 state     = $7,
                 country   = $8
           WHERE id = $9
           RETURNING id, firstname, lastname, email, phone, address1, city, state, country
          `,
          [
            nextFields.firstname,
            nextFields.lastname,
            nextFields.email,
            nextFields.phone,
            nextFields.address1,
            nextFields.city,
            nextFields.state,
            nextFields.country,
            existingUserRow.id,
          ]
        );
        if (!updateResult.rowCount) {
          return res.status(500).send("Profile details did not persist.");
        }

        req.user = {
          ...req.user,
          firstname: nextFields.firstname,
          lastname: nextFields.lastname,
          email: nextFields.email,
          phone: nextFields.phone,
          address1: nextFields.address1,
          city: nextFields.city,
          state: nextFields.state,
          country: nextFields.country,
        };

        return res.redirect(buildProfileRedirectPath(buildProfileRedirectParams(actionState)));
      } catch (err) {
        console.error("Error updating profile account details:", err);
        return res.status(500).send("Error updating profile details");
      }
    },

    async postPreferences(req, res) {
      try {
        const requestedAction = resolveProfileSaveAction(req.body?.profile_action);
        const actionState = requestedAction.isPreferenceSave
          ? requestedAction
          : resolveProfileSaveAction("save_preferences");
        const existingUserRow = await fetchExistingProfileUserRow(req);
        if (!existingUserRow?.id) {
          return res.status(404).send("Profile record not found.");
        }

        const nextFields = buildProfileFieldUpdates({
          actionState,
          body: req.body || {},
          existingUserRow
        });

        let locationPrefs;
        try {
          locationPrefs = parseLocationFromRequestBody(req.body || {}, existingUserRow);
        } catch (validationErr) {
          return res.status(400).send(`Invalid location settings: ${validationErr.message}`);
        }

        let availability;
        try {
          availability = parseAvailabilityFromRequestBody(
            { ...(req.body || {}), timezone: locationPrefs.timezone },
            existingUserRow
          );
        } catch (validationErr) {
          return res.status(400).send(`Invalid availability settings: ${validationErr.message}`);
        }

        const updateResult = await pool.query(
          `
          UPDATE userdata
             SET interest1 = $1,
                 interest2 = $2,
                 interest3 = $3,
                 sdg1 = $4,
                 sdg2 = $5,
                 sdg3 = $6,
                 availability_weekly = $7::jsonb,
                 specfifc_availability = $8::jsonb,
                 home_base_lat = $9,
                 home_base_lng = $10,
                 home_base_label = $11,
                 home_base_source = $12,
                 travel_radius_km = $13,
                 travel_mode = $14,
                 timezone = $15
           WHERE id = $16
           RETURNING id
          `,
          [
            nextFields.interest1,
            nextFields.interest2,
            nextFields.interest3,
            nextFields.sdg1,
            nextFields.sdg2,
            nextFields.sdg3,
            JSON.stringify(availability.weekly),
            JSON.stringify(availability.exceptions),
            locationPrefs.lat,
            locationPrefs.lng,
            locationPrefs.label,
            locationPrefs.source,
            locationPrefs.travel_radius_km,
            locationPrefs.travel_mode,
            locationPrefs.timezone,
            existingUserRow.id,
          ]
        );
        if (!updateResult.rowCount) {
          return res.status(500).send("Profile preferences did not persist.");
        }

        req.user = {
          ...req.user,
          interest1: nextFields.interest1,
          interest2: nextFields.interest2,
          interest3: nextFields.interest3,
          sdg1: nextFields.sdg1,
          sdg2: nextFields.sdg2,
          sdg3: nextFields.sdg3,
          availability_weekly: availability.weekly,
          specfifc_availability: availability.exceptions,
          home_base_lat: locationPrefs.lat,
          home_base_lng: locationPrefs.lng,
          home_base_label: locationPrefs.label,
          home_base_source: locationPrefs.source,
          travel_radius_km: locationPrefs.travel_radius_km,
          travel_mode: locationPrefs.travel_mode,
          timezone: locationPrefs.timezone,
        };

        return res.redirect(buildProfileRedirectPath(buildProfileRedirectParams(actionState)));
      } catch (err) {
        console.error("Error updating profile preferences:", err);
        if (err && err.code === "42703") {
          return res.status(500).send("Profile preference columns are missing. Run profile migrations in scripts/migrations.");
        }
        return res.status(500).send("Error updating profile preferences");
      }
    }
  };
}
