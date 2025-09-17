
// Climate Risk analysis in LA


// first we will define our region of interest (Los Angeles)
var la = ee.Geometry.Rectangle([-118.7, 33.7, -118.1, 34.3]);

// now we’ll create a function that wil mask clouds in our Landsat 8 image
function maskL8sr(image) {
  var cloudShadowBitMask = (1 << 3);
  var cloudsBitMask = (1 << 5);
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
               .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  return image.updateMask(mask);
}

// now we obtain the Landsat 8 summer collection of 2022
var summerCollection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterDate('2022-06-01', '2022-08-31')
  .filterBounds(la)
  .map(maskL8sr);

// we collect the surface temperature in Celsius
var surfaceTemp = summerCollection.select('ST_B10').median();
var surfaceTempC = surfaceTemp.multiply(0.00341802).add(149.0).subtract(273.15).rename('tempC');

// we will also obtain the vegetation index in the region
var ndvi = summerCollection.median()
  .normalizedDifference(['SR_B5', 'SR_B4'])
  .rename('NDVI');

// now we add population information to be able to see the heat differences between crowded and emptier regions
var popCol = ee.ImageCollection("projects/sat-io/open-datasets/WORLDPOP/pop")
  .filterDate('2020-01-01','2020-12-31');
var population = popCol.first().select('population');

// now we will calculate our modest Urban Heat Island index
var urbanMask = population.gt(1000); // a mask where pixels with population > 1000 are considered "urban" (arbitrary threshold)
var ruralTemp = surfaceTempC.updateMask(urbanMask.not()); // .not() inverts urban regions to get rural areas 

var meanRural = ruralTemp.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: la,
  scale: 500,
  maxPixels: 1e9,
  tileScale: 2
}).get('tempC'); // the result shows how much hotter each location is compared to rural areas

// to ensure meanRuralTemp is never null, we add a fallback of 25°C
var meanRuralTemp = ee.Number(ee.Algorithms.If(meanRural, meanRural, 25));

print('Mean rural temperature (°C):', meanRuralTemp);

var uhiIndex = surfaceTempC.subtract(meanRuralTemp).rename('UHI_Index');

// now for the visualization on the map
var tempVis = {min: 20, max: 45, palette: ['blue', 'yellow', 'red']};
var uhiVis = {min: -5, max: 5, palette: ['blue', 'white', 'red']}; // blue: cooler than rural areas, white: similar to rural areas, red: warmer than rural areas
var ndviVis = {min: -0.2, max: 0.6, palette: ['brown', 'yellow', 'green']};
var popVis = {min: 0, max: 5000, palette: ['white','blue']};

Map.centerObject(la, 10);
Map.addLayer(surfaceTempC, tempVis, 'Surface Temp (°C)');
Map.addLayer(uhiIndex, uhiVis, 'Urban Heat Island (°C above rural)');
Map.addLayer(ndvi, ndviVis, 'NDVI');
Map.addLayer(population, popVis, 'Population');

// we will calculate now the stdDev and mean
var stats = uhiIndex.addBands(population).addBands(ndvi)
  .reduceRegion({
    reducer: ee.Reducer.mean().combine({
      reducer2: ee.Reducer.stdDev(),
      sharedInputs: true
    }),
    geometry: la,
    scale: 1000,
    maxPixels: 1e9,
    tileScale: 2
  });

print('Summary Statistics:', stats);

// finally, we will create a scatter plot that compares NDVI (vegetation) vs UHI
var samplePoints = ee.FeatureCollection.randomPoints(la, 500);
var sampledData = uhiIndex.addBands(ndvi).sampleRegions({
  collection: samplePoints,
  scale: 500,
  tileScale: 2
});

var chart = ui.Chart.feature.byFeature({
  features: sampledData,
  xProperty: 'NDVI',
  yProperties: ['UHI_Index']
}).setChartType('ScatterChart')
  .setOptions({
    title: 'Vegetation vs UHI',
    hAxis: {title: 'NDVI'},
    vAxis: {title: 'Urban Heat Island (°C)'},
    pointSize: 3,
    colors: ['green']
  });

print(chart);
