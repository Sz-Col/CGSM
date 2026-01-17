# NDVI-Based Aquatic Vegetation Monitoring – Complejo Pajarales (CGSM, Colombia)

This repository provides a documented Google Earth Engine (GEE) workflow for quantifying and visualizing the expansion of aquatic vegetation within the **Complejo Pajarales**, a sub-basin of the **Ciénaga Grande de Santa Marta (CGSM)**, Colombia.  
The script performs monthly NDVI-based analyses using **Sentinel-2 MSI Level-2A (Surface Reflectance)** imagery to assess vegetation cover dynamics over the past 18 months.

---

## Overview

The GEE script performs two main tasks:

1. **Statistical analysis (18 months):**  
   Computes monthly NDVI composites, vegetation-covered area (ha), number of valid Sentinel-2 scenes, and fraction of valid (non-cloudy) pixels.  
   Exports a CSV file named:
   ```
   Pajarales_NDVI040_monthly_median_18m.csv
   ```

2. **Spatial visualization (12 months):**  
   Generates 12 overlay images combining:
   - True-color median composites  
   - NDVI ≥ 0.40 vegetation mask (red)  
   - AOI outline (yellow)  

   Each image is exported as:
   ```
   Pajarales_YYYY-MM.png
   ```

---

## Study Area

- **Region:** Complejo Pajarales, Ciénaga Grande de Santa Marta, Colombia  
- **Approx. surface area:** 6,074 ha  
- **Coordinates:**
  ```
[-74.61411596960272, 10.829045512816178],
          [-74.61068274206366, 10.816231300319165],
          [-74.61119772619452, 10.79105479581324],
          [-74.60879446691717, 10.775540821921297],
          [-74.58218695348944, 10.772336749407717],
          [-74.57240225500311, 10.781948864638203],
          [-74.55660940832342, 10.798685650401252],
          [-74.5370402527896, 10.815041936973051],
          [-74.52914358801092, 10.827349939881366],
          [-74.50768591589178, 10.831396442351124],
          [-74.48451163000311, 10.836454493545562],
          [-74.4838249844953, 10.844041410065644],
          [-74.4944676941174, 10.851459251908537],
          [-74.50682731325803, 10.85685414159808],
          [-74.50493903811154, 10.860394485014938],
          [-74.51266380007444, 10.88045563790864],
          [-74.5329198425549, 10.884838567318647],
          [-74.54493613894162, 10.88399570128454],
          [-74.55420585329709, 10.862754690644051],
          [-74.5717563781058, 10.851668173729724],
          [-74.59613229363315, 10.846610379742115],
          [-74.60385705559604, 10.841721097568819]
  ```
- **Features:** semi-enclosed aquatic system with seasonal vegetation and fluctuating water levels; includes the stilt village *Nueva Venecia*.

---

## Data Sources

- **Satellite imagery:** Sentinel-2 MSI (Level-2A, Surface Reflectance)  
  - Collection: `COPERNICUS/S2_SR_HARMONIZED`  
  - Bands used: B4 (Red, 665 nm) and B8 (NIR, 842 nm)  
  - Temporal coverage: last 18 full months  
  - Cloud filter: `CLOUDY_PIXEL_PERCENTAGE ≤ 80`  
- **Processing environment:** [Google Earth Engine](https://earthengine.google.com/)  
- **Auxiliary masking:** Sentinel-2 QA60 bitmask (cloud/cirrus bits 10–11)

---

## Output Summary

| Output Type | Description | File Format | Folder |
|--------------|-------------|-------------|---------|
| Monthly statistics | NDVI ≥ 0.40 vegetation area, valid fraction, scene count | CSV | `CGSM_ComplejoPajarales` |
| Monthly overlay panels | True color + NDVI mask + AOI outline | PNG | `CGSM_ComplejoPajarales` |

The CSV includes four columns:

| Column | Description |
|---------|--------------|
| `month` | Month (YYYY-MM) |
| `area_ha` | Vegetation-covered area (ha) |
| `n_scenes` | Number of valid Sentinel-2 scenes used |
| `valid_frac` | Fraction of valid (non-cloudy) pixels |

---

## Visualization & Console Output

When executed in the **Earth Engine Code Editor**:
- The AOI is displayed as a **yellow outline** on the Map.
- A **line chart** (NDVI ≥ 0.40 area vs. month) appears in the Console panel.

---

## Script Parameters

| Variable | Default | Description |
|-----------|----------|-------------|
| `NDVI_THR` | 0.40 | NDVI threshold for vegetation |
| `CLOUDY_PCT` | 80 | Maximum allowed cloudiness (%) |
| `SCALE_VIS` | 10 | Pixel scale (m) for visual exports |
| `SCALE_STAT` | 30 | Pixel scale (m) for statistical exports |
| `TILE_SCALE` | 4 | Reducer tileScale to optimize performance |
| `BUFFER_M` | 2500 | Buffer (m) around AOI for image framing |
| `EXPORT_FOLDER` | `CGSM_ComplejoPajarales` | Google Drive output folder |
| `DO_EXPORT_STATS` | true | Enable/disable CSV export |
| `DO_EXPORT_PANELS` | true | Enable/disable overlay export |

---

## How to Use

1. Open the script in the **[Google Earth Engine Code Editor](https://code.earthengine.google.com/)**.  
2. Adjust parameters if necessary (e.g., NDVI threshold, AOI, export folder).  
3. Click **Run**.  
4. When tasks appear under the **Tasks** tab:
   - 1 × CSV (18 months)
   - 12 × image exports (1 per month)  
   Click **Run** next to each to start exports to Google Drive.

---

## Citation

If you use this code in research or publications, please cite as:

> Salzwedel, H., J. C. Mejía-Rentería & J. E. Mancera P. (2026). *NDVI-based monitoring of aquatic vegetation in the Complejo Pajarales (Ciénaga Grande de Santa Marta, Colombia)* (Version 1.0.0) [Source code]. GitHub. [https://github.com/SI-CGSM/CGSM_Pajarales_NDVI](https://github.com/SI-CGSM/CGSM_Pajarales_NDVI)  
> DOI: *[to be assigned by Zenodo]*  

And cite the supporting platforms:

> Gorelick, N. et al. (2017). Google Earth Engine: Planetary-scale geospatial analysis for everyone. *Remote Sensing of Environment, 202*, 18-27.  
> OpenAI (2025). ChatGPT (GPT-5) code concept assistance. [https://chat.openai.com](https://chat.openai.com)  

---

## License

This repository is distributed under the **MIT License**.

---

## Author & Contact

**Horst Salzwedel**  
Fundación Documental Sí-CGSM  
Email: [sicgsm@gmail.com]  
Location: Santa Marta, Colombia  
