/************************************************************
 CGSM – Complejo Pajarales (CGSM, Colombia)
 Final merged workflow (documented)
 Outputs:
   (A) CSV for last 18 FULL months with columns:
       month, area_ha, n_scenes, valid_frac
   (B) 12 monthly overlay images for last 12 FULL months:
       true-color median + NDVI≥0.40 mask + AOI outline

 Also:
   • Displays AOI outline on the Map
   • Prints a line chart of area_ha in the Console

 Notes:
   • Duplicate products removed via distinct('PRODUCT_ID')
   • Sequential reduceRegion to avoid "Too many concurrent aggregations"
   • All exports go to Google Drive folder: CGSM_ComplejoPajarales
************************************************************/

// =========================== USER PARAMETERS ===========================
var NDVI_THR      = 0.40;      // Vegetation threshold
var CLOUDY_PCT    = 80;        // Max CLOUDY_PIXEL_PERCENTAGE for S2 filter
var SCALE_VIS     = 10;        // Export scale (meters) for overlay imagery
var SCALE_STAT    = 30;        // Analysis scale (meters) for area stats
var TILE_SCALE    = 4;         // tileScale for reducers (performance knob)
var BUFFER_M      = 2500;      // Padding around AOI for exported images
var EXPORT_FOLDER = 'CGSM_ComplejoPajarales'; // <— requested output folder

// Switches (leave both true per your request)
var DO_EXPORT_STATS  = true;    // Export CSV for last 18 full months
var DO_EXPORT_PANELS = true;    // Export 12 overlay images for last 12 full months

// ================================ AOI =================================
var AOI = ee.FeatureCollection('projects/ee-juanrenteria/assets/Poligono_Agua_Pajarales').geometry();

// var AOI = ee.Geometry.Polygon([[
//   [-74.5921864,10.8397632],
//   [-74.5924010,10.8192778],
//   [-74.5436919,10.8197415],
//   [-74.5434774,10.8399739],
//   [-74.5921864,10.8397632]
// ]]);
// AOI outline for overlays & Map display (yellow, 2 px)
var AOI_outline_img = ee.Image().byte().paint(AOI, 1, 2).visualize({palette: ['#ffff00']});

// Show AOI on the map (so it’s visible below the Console panel)
Map.centerObject(AOI, 12);
Map.addLayer(AOI, {color: 'yellow'}, 'AOI (outline)');

// ====================== SENTINEL-2 & MASKING ==========================
/**
 * QA60 cloud/cirrus + non-zero reflectance masking; clip to AOI.
 */
function maskS2(img) {
  var qa = img.select('QA60');
  var cloudFree = qa.bitwiseAnd(1 << 10).eq(0) // cloud
                  .and(qa.bitwiseAnd(1 << 11).eq(0)); // cirrus
  var nonZero = img.select(['B8','B4']).reduce(ee.Reducer.min()).gt(0);
  return img.updateMask(cloudFree).updateMask(nonZero).clip(AOI);
}

// Base collection (band subset for speed)
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(AOI)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CLOUDY_PCT))
  .select(['B2','B3','B4','B8','QA60'])
  .map(maskS2);

// ======================= DATE HELPERS (FULL MONTHS) ===================
var today        = ee.Date(Date.now());
var currentMonth = today.update({day: 1}); // start of current month
var lastFull     = currentMonth.advance(-1, 'month'); // start of last FULL month

/**
 * Returns a server-side list of month starts (inclusive) for n months, ascending.
 */
function monthStarts(startDate, n) {
  startDate = ee.Date(startDate).update({day: 1});
  return ee.List.sequence(0, n - 1).map(function(i) {
    return startDate.advance(i, 'month');
  });
}

// ================== MONTHLY METRIC (ONE MONTH) ========================
/**
 * Builds the monthly median NDVI, computes:
 *  - area_ha of NDVI ≥ NDVI_THR
 *  - n_scenes = number of distinct DATATAKE_IDENTIFIER
 *  - valid_frac = mean mask value (fraction of valid pixels)
 * Returns: ee.Feature with properties month, area_ha, n_scenes, valid_frac, system:time_start
 */
function computeMonthlyFeature(m0) {
  m0 = ee.Date(m0);
  var m1 = m0.advance(1, 'month');

  // Distinct products to avoid duplicates
  var col = s2.filterDate(m0, m1).distinct('PRODUCT_ID');

  // Distinct datatakes actually contributing
  var nScenes = ee.Number(col.aggregate_array('DATATAKE_IDENTIFIER').distinct().size());

  // Monthly median NDVI
  var ndviMed = ee.ImageCollection(col.map(function(im) {
      return ee.Image(im).normalizedDifference(['B8','B4']).rename('NDVI');
    }))
    .median()
    .rename('NDVI')
    .clip(AOI);

  // Valid mask (after QA) and vegetation mask
  var valid = ndviMed.mask();                         // 1 where usable
  var veg   = ndviMed.gte(NDVI_THR).updateMask(valid);

  // Compute vegetation area (ha) and valid fraction
  var areaBand  = ee.Image.pixelArea().updateMask(veg).rename('area');
  var validBand = valid.rename('valid');

  var reducer = ee.Reducer.sum().combine({
    reducer2: ee.Reducer.mean(), sharedInputs: true
  });

  var stats = ee.Image.cat(areaBand, validBand).reduceRegion({
    reducer: reducer,
    geometry: AOI,
    scale: SCALE_STAT,
    tileScale: TILE_SCALE,
    bestEffort: true,
    maxPixels: 1e13
  });

  // Safely coerce to numbers (avoid nulls)
  var areaHa    = ee.Number(stats.get('area_sum')).divide(10000);
  areaHa        = ee.Algorithms.If(areaHa, areaHa, 0);
  var validFrac = ee.Number(stats.get('valid_mean'));
  validFrac     = ee.Algorithms.If(validFrac, validFrac, 0);

  return ee.Feature(null, {
    month      : m0.format('YYYY-MM'),
    area_ha    : ee.Number(areaHa),
    n_scenes   : nScenes,
    valid_frac : ee.Number(validFrac),
    'system:time_start': m0.millis()
  });
}

// ================= (A) 18-MONTH STATS: CSV + CHART ====================
if (DO_EXPORT_STATS) {
  var nStatsMonths = 18;
  var statsStart   = lastFull.advance(-(nStatsMonths - 1), 'month');
  var months18     = monthStarts(statsStart, nStatsMonths);

  // Sequential construction to avoid "Too many concurrent aggregations"
  var empty = ee.List([]);
  var featuresList = ee.List(months18).iterate(function(m, acc) {
    var f = computeMonthlyFeature(m);
    return ee.List(acc).add(f);
  }, empty);

  var monthlyFC = ee.FeatureCollection(ee.List(featuresList)).sort('system:time_start');

  // Export CSV with all columns
  Export.table.toDrive({
    collection: monthlyFC,
    description: 'Pajarales_NDVI040_monthly_median_18m',
    folder: EXPORT_FOLDER,
    fileFormat: 'CSV'
  });

  // Console chart: area_ha vs month
  var chart = ui.Chart.feature.byFeature(monthlyFC, 'month', 'area_ha')
    .setChartType('LineChart')
    .setOptions({
      title: 'Monthly area with NDVI ≥ 0.40 (ha) — last 18 full months',
      hAxis: { title: 'Month', slantedText: true },
      vAxis: { title: 'Area (ha)' },
      legend: { position: 'none' },
      lineWidth: 2,
      pointSize: 4
    });
  print(chart);

  // Optional: quick preview of the first rows
  print('18-month stats (head):', monthlyFC.limit(5));
}

// ============ (B) 12-MONTH PANELS: OVERLAY EXPORTS ====================
if (DO_EXPORT_PANELS) {
  var nPanelMonths = 12;
  var panelStart   = lastFull.advance(-(nPanelMonths - 1), 'month');
  var months12     = monthStarts(panelStart, nPanelMonths);
  var months12Str  = ee.List(months12.map(function(d) { return ee.Date(d).format('YYYY-MM'); }));

  var visRGB       = { bands: ['B4','B3','B2'], min: 0, max: 3000 };
  var regionExport = AOI.buffer(BUFFER_M).bounds({ maxError: 10 });

  months12Str.evaluate(function(listYM) {
    listYM.forEach(function(ym) {
      var m0 = ee.Date.parse('YYYY-MM', ym);
      var m1 = m0.advance(1, 'month');

      var col = s2.filterDate(m0, m1).distinct('PRODUCT_ID');

      // True-color monthly median
      var rgb = ee.ImageCollection(col).median().visualize(visRGB);

      // NDVI monthly median
      var ndviM = ee.ImageCollection(col.map(function(im) {
                      return ee.Image(im).normalizedDifference(['B8','B4']).rename('NDVI');
                    }))
                    .median()
                    .rename('NDVI');

      // Vegetation mask (red) + AOI outline (yellow)
      var vegMask = ndviM.gte(NDVI_THR).selfMask().visualize({ palette: ['#ff0000'], opacity: 0.6 });
      var frame   = rgb.blend(vegMask).blend(AOI_outline_img);

      var name = 'Pajarales_' + ym;

      Export.image.toDrive({
        image: frame,
        description: name,
        folder: EXPORT_FOLDER,
        fileNamePrefix: name,
        region: regionExport,
        scale: SCALE_VIS,
        maxPixels: 1e13
      });
    });
    print('Created export tasks for 12 monthly panels:', listYM.length);
  });
}
