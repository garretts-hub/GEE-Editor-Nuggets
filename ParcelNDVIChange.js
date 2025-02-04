/*
 This Script takes selected parcels from the state of Vermont, chosen to be those within 500m of the PMRC parcel,
 and calculates their monthly NDVI mean, plotting them over time. 
*/

/* Perform imports */
var uva_parcels_fc = ee.FeatureCollection("projects/garrett0524/assets/VT_Parcel_Assets/Use_Value_Appraisal_Parcels"),
    vt_parcels_fc = ee.FeatureCollection("projects/garrett0524/assets/VT_Parcel_Assets/VT_Parcels"),
    vt_counties = ee.FeatureCollection("projects/garrett0524/assets/VT_Parcel_Assets/VT_Counties");

/* Convert imported feature classes to features as needed */
uva_parcels_fc = ee.FeatureCollection(uva_parcels_fc.map(function(f) { return ee.Feature(f) }))
vt_parcels_fc = ee.FeatureCollection(vt_parcels_fc.map(function(f) { return ee.Feature(f) }))
var vt_feature = vt_parcels_fc.geometry().dissolve()
var proctor_feature = ee.Feature(vt_parcels_fc.filter(ee.Filter.eq("PARCID","MY364-X")).first())

/* Import functions from the s2cloudless script. */
var s2cloudless = require('users/gsimon1/VT_Parcel_Studies:s2cloudless')
// The primary imported function is s2cloudless.get_filtered_s2sr(region, start_date, end_date, max_cloud_probability)

/* Define Region geometry of interest */
var distanceFilter = ee.Filter.withinDistance({distance: 500, leftField:'.geo', rightField:'.geo',maxError:10})
var saveAllJoin = ee.Join.saveAll({matchesKey: 'withinDistance', measureKey:'distance'})
var joinOperation = saveAllJoin.apply(proctor_feature, vt_parcels_fc, distanceFilter);
var overlapping_fc = ee.FeatureCollection(ee.List(ee.Feature(joinOperation.first()).get('withinDistance'))).filter(ee.Filter.eq("PROPTYPE", "PARCEL"))
var region_geom = overlapping_fc.geometry().dissolve()
print(region_geom)


/* Get June-July low-NDVI mask for every year, so that we can filter out the same non-vegetation pixels across all months*/
var years = ee.List.sequence(2019,2024)
var max_cloud_prob = 75
var annual_start = years.map( function(y) {return ee.Date(ee.String(ee.Number(y).int()).cat('-06-01'))} )

var get_monthly_low_ndvi = function(start_date) {
  var end_date = ee.Date(start_date).advance(2, 'month')
  var filtered_s2_collection = s2cloudless.get_filtered_s2sr(region_geom, start_date, end_date, max_cloud_prob) //max allowed cloud probability
  var s2_mean_image = filtered_s2_collection.mean()
  var ndvi = s2_mean_image.normalizedDifference(['B8', 'B4']).rename('ndvi')
  var low_ndvi_mask = ndvi.lte(0.6).rename('low_ndvi_mask')
  var low_ndvi = ndvi.mask(low_ndvi_mask).rename('low_ndvi')
  return s2_mean_image.addBands([ndvi, low_ndvi, low_ndvi_mask]).set('year', ee.Date(start_date).get('year'))
}
var annual_summer_filter = ee.ImageCollection(ee.FeatureCollection(annual_start.map(get_monthly_low_ndvi)))

/* Collect monthly data for the region of interest, mask out low-NDVI cells for that year, and calculate NDVI stats */
var nSteps = ee.List.sequence(0, ee.Number(years.get(-1)).subtract(years.get(0)).multiply(12).subtract(1))
var add_months = function(numMonths) { return ee.Date(ee.String(ee.Number(years.get(0)).int())).advance(numMonths, 'month') } 
var monthly_start_dates = nSteps.map(add_months);
var get_monthly_ndvi_images = function(monthly_start_date) {
  var monthly_end_date = ee.Date(monthly_start_date).advance(1, 'month')
  var year = ee.Date(monthly_start_date).get('year')
  var month = ee.Date(monthly_start_date).get('month')
  var cloudfiltered_s2_collection = s2cloudless.get_filtered_s2sr(region_geom, monthly_start_date, monthly_end_date, max_cloud_prob)
  var annual_low_ndvi_mask = annual_summer_filter.filter(ee.Filter.eq('year',year)).select('low_ndvi_mask').first()
  var inverted_annual_low_ndvi_mask = annual_low_ndvi_mask.eq(0)
  var monthly_mean = cloudfiltered_s2_collection.mean().set('year',year).set('month',month).set('start_date',monthly_start_date).set('end_date',monthly_end_date)
  var ndvi_band_masked = monthly_mean.normalizedDifference(['B8', 'B4']).rename('ndvi').mask(inverted_annual_low_ndvi_mask)
  return monthly_mean.addBands([ndvi_band_masked]).set('system:time_start', monthly_start_date).set('system:time_end', monthly_end_date)
};
var monthly_ndvi_collection = ee.ImageCollection(ee.FeatureCollection(monthly_start_dates.map(get_monthly_ndvi_images)))

/* Now  apply a Reducer to every monthly image in the collection to get zonal statistics on each parcel for each month */
var get_monthly_region_mean = function(image, reductionRegionsFc) {
  // Rename the band, since the reduction output will get assigned to a property in the feature based on the bandname
  var y = image.get('year')
  var m = image.get('month')
  var date = ee.Date(ee.String(ee.Number(y).int()).cat("-").cat(ee.String(ee.Number(m).int())).cat("-1"))
  var name = ee.String('mean_ndvi_').cat(
    ee.String(ee.Number(y).int()).cat("_").cat(
      ee.String(ee.Number(m).int())
      )
    )
  var ndvi = image.select(['ndvi']).rename(['mean_ndvi'])
  // Each feature in the feature class gets the year-month mean value as a property, with the name "mean_ndvi_yyyy_mm"
  var fc_with_monthly_mean_data = ndvi.reduceRegions({collection:reductionRegionsFc, reducer:ee.Reducer.mean().setOutputs([name]), scale:20})
  // Extract this newly calculated value from each of the features and put it into a list, along with the date. 
  // You no longer need the specific date property in the feature.
  fc_with_monthly_mean_data = fc_with_monthly_mean_data.map(function(f) {return f.set("date_list", ee.List(f.get("date_list")).add(date))})
  fc_with_monthly_mean_data = fc_with_monthly_mean_data.map(function(f) {return f.set("mean_ndvi_list", ee.List(f.get("mean_ndvi_list")).add(f.get(name)))})
  var removeUnnecessaryProperty_list = fc_with_monthly_mean_data.propertyNames().filter(ee.Filter.neq('item', date))
  fc_with_monthly_mean_data = fc_with_monthly_mean_data.map(function(f) {return f.select(f.propertyNames().filter(ee.Filter.neq('item', name)))} )
  return fc_with_monthly_mean_data
}
// We need to cumulatively append the monthly statistics to the Feature Collection.
// Be careful about trying to print the whole thing.
var initial_fc = overlapping_fc.map(function(f) {return f.set({date_list: ee.List([]), mean_ndvi_list: ee.List([])})})
var zonal_stats_fc = ee.FeatureCollection(monthly_ndvi_collection.filter(ee.Filter.rangeContains('year', 2020, 2021)).iterate(get_monthly_region_mean, initial_fc))
//Create names for the plot legend:
initial_fc = initial_fc.map(function(f) {
  var span = ee.String(f.get('SPAN'))
  var town = ee.String(f.get('TNAME'))
  var cat = ee.String(f.get('CAT'))
  var label = ee.String("SPAN: ").cat(span).cat(ee.String(",\nTown: ").cat(town).cat(ee.String(",\nCategory: ").cat(cat)))
  return f.set('label',label)
})


/* Let's plot our monthly NDVI values per parcel */
var chart = ui.Chart.image.seriesByRegion({
  imageCollection:ee.FeatureCollection(monthly_ndvi_collection.filter(ee.Filter.rangeContains('year', 2019, 2023))),
  band:'ndvi',
  regions:initial_fc,
  reducer:ee.Reducer.mean(),
  scale:500,
  seriesProperty:'label',
  xProperty:'system:time_start'
})

var chartStyle = {
  title: 'Monthly NDVI across Parcels',
  hAxis: {
    title: 'Month',
    titleTextStyle: {italic: false, bold: true},
    gridlines: {color: 'FFFFFF'}
  },
  vAxis: {
    title: 'Mean NDVI',
    titleTextStyle: {italic: false, bold: true},
    gridlines: {color: 'FFFFFF'},
    format: 'short',
    baselineColor: 'FFFFFF'
  },
  chartArea: {backgroundColor: 'EBEBEB'}
};

print(chart.setOptions(chartStyle))

Map.addLayer(overlapping_fc.style({"fillColor":"0000FF20", "color":'black'}), {},"Parcels of Interest")
Map.centerObject(region_geom, 14);