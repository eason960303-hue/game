import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:life_logger/models/location_point.dart';
import 'package:life_logger/models/map_place.dart';
import 'package:life_logger/screens/create_footprint_screen.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/services/location_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/utils/map_format.dart';
import 'package:url_launcher/url_launcher.dart';

const _apiKey = String.fromEnvironment('GOOGLE_MAPS_API_KEY');
const _taiwan = CameraPosition(target: LatLng(23.7, 120.95), zoom: 6.5);

/// The Google Maps plugin has no macOS implementation, and iOS crashes without a key.
bool get googleMapsAvailable =>
    _apiKey.isNotEmpty && !kIsWeb && (Platform.isAndroid || Platform.isIOS);

List<RouteStop> _stopsOf(LocationPoint point) {
  if (point.stops.isNotEmpty) return point.stops;
  if (point.latitude == null || point.longitude == null) return const [];
  return [
    RouteStop(
      name: point.name,
      latitude: point.latitude!,
      longitude: point.longitude!,
    ),
  ];
}

Set<Polyline> _routeLines(List<LocationPoint> points) => {
      for (final point in points)
        if (_stopsOf(point).length > 1)
          Polyline(
            polylineId: PolylineId('${point.id}'),
            points: [
              for (final stop in _stopsOf(point))
                LatLng(stop.latitude, stop.longitude),
            ],
            color: AppColors.accent,
            width: 4,
            patterns: [PatternItem.dash(16), PatternItem.gap(10)],
          ),
    };

void _fitToCoordinates(
  GoogleMapController? controller,
  List<LatLng> coordinates,
) {
  if (controller == null || coordinates.isEmpty) return;
  if (coordinates.length == 1) {
    controller.animateCamera(CameraUpdate.newLatLngZoom(coordinates.first, 15));
    return;
  }
  final latitudes = coordinates.map((point) => point.latitude);
  final longitudes = coordinates.map((point) => point.longitude);
  controller.animateCamera(
    CameraUpdate.newLatLngBounds(
      LatLngBounds(
        southwest: LatLng(latitudes.reduce(min), longitudes.reduce(min)),
        northeast: LatLng(latitudes.reduce(max), longitudes.reduce(max)),
      ),
      64,
    ),
  );
}

List<LatLng> _stopCoordinates(List<LocationPoint> points) => [
      for (final stop in points.expand(_stopsOf))
        LatLng(stop.latitude, stop.longitude),
    ];

Set<Marker> _markers(List<LocationPoint> points, {void Function(RouteStop)? onTap}) => {
      for (final point in points)
        for (final (index, stop) in _stopsOf(point).indexed)
          Marker(
            markerId: MarkerId('${point.id}:$index'),
            position: LatLng(stop.latitude, stop.longitude),
            infoWindow: InfoWindow(title: point.name, snippet: stop.name),
            onTap: onTap == null ? null : () => onTap(stop),
          ),
    };

/// The non-interactive map on the journey tab; tapping opens the full map.
class FootprintMapPreview extends StatelessWidget {
  const FootprintMapPreview({
    super.key,
    required this.points,
    required this.onFootprintsChanged,
  });

  final List<LocationPoint> points;
  final VoidCallback onFootprintsChanged;

  Future<void> _openFullMap(BuildContext context) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => FootprintMapScreen(points: points)),
    );
    if (changed == true) onFootprintsChanged();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: SizedBox(
        height: 240,
        width: double.infinity,
        child: GoogleMap(
          initialCameraPosition: _taiwan,
          markers: _markers(points),
          polylines: _routeLines(points),
          scrollGesturesEnabled: false,
          zoomGesturesEnabled: false,
          rotateGesturesEnabled: false,
          tiltGesturesEnabled: false,
          zoomControlsEnabled: false,
          mapToolbarEnabled: false,
          myLocationButtonEnabled: false,
          onMapCreated: (controller) =>
              _fitToCoordinates(controller, _stopCoordinates(points)),
          onTap: (_) => _openFullMap(context),
        ),
      ),
    );
  }
}

enum _MapSheet { none, results, place, directions }

const _searchChips = ['餐廳', '咖啡廳', '飯店', '景點', '加油站', '超商', '停車場'];
const _travelModes = {
  'DRIVING': ('開車', Icons.directions_car),
  'TRANSIT': ('大眾運輸', Icons.directions_transit),
  'WALKING': ('步行', Icons.directions_walk),
  'BICYCLING': ('單車', Icons.directions_bike),
};
const _maxIntermediateStops = 9;

class FootprintMapScreen extends StatefulWidget {
  const FootprintMapScreen({
    super.key,
    required this.points,
    this.locate = currentCoordinates,
    this.mapOverride,
  });

  final List<LocationPoint> points;
  final Future<Coordinates> Function() locate;

  /// Replaces the native map view, which widget tests cannot create.
  final Widget? mapOverride;

  @override
  State<FootprintMapScreen> createState() => _FootprintMapScreenState();
}

class _FootprintMapScreenState extends State<FootprintMapScreen> {
  static const _mapTypes = {
    MapType.normal: '預設',
    MapType.satellite: '衛星',
    MapType.hybrid: '混合',
    MapType.terrain: '地形',
  };
  static const _searchDebounce = Duration(milliseconds: 250);

  final _random = Random();
  final _searchController = TextEditingController();
  final _originController = TextEditingController();
  final _destinationController = TextEditingController();
  final List<TextEditingController> _intermediateControllers = [];

  GoogleMapController? _controller;
  LatLng _cameraTarget = _taiwan.target;
  MapType _mapType = MapType.normal;
  bool _trafficEnabled = false;
  bool _buildingsEnabled = true;
  bool _myLocationEnabled = false;

  Timer? _debounce;
  String? _sessionToken;
  int _latestSuggestionRequest = 0;
  int _latestPlaceRequest = 0;
  List<PlaceSuggestion> _suggestions = const [];

  _MapSheet _sheet = _MapSheet.none;
  bool _isLoading = false;
  bool _showSearchArea = false;
  bool _placeFromResults = false;
  bool _footprintsChanged = false;
  String _lastQuery = '';
  List<MapPlace> _results = const [];
  MapPlace? _place;

  String _travelMode = 'DRIVING';
  bool _avoidTolls = false;
  bool _avoidHighways = false;
  bool _avoidFerries = false;
  List<MapRoute> _routes = const [];
  final _routePaths = Expando<List<LatLng>>();
  int _selectedRoute = 0;
  Uri? _navigationUri;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller?.dispose();
    _searchController.dispose();
    _originController.dispose();
    _destinationController.dispose();
    for (final controller in _intermediateControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Coordinates get _center =>
      (latitude: _cameraTarget.latitude, longitude: _cameraTarget.longitude);

  // --- Search ---

  String _newSessionToken() => List.generate(
        32,
        (_) => _random.nextInt(16).toRadixString(16),
      ).join();

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    final query = value.trim();
    final requestId = ++_latestSuggestionRequest;
    if (query.isEmpty) {
      setState(() => _suggestions = const []);
      return;
    }
    _debounce = Timer(_searchDebounce, () async {
      _sessionToken ??= _newSessionToken();
      try {
        final suggestions = await ApiService.fetchPlaceSuggestions(
          query,
          sessionToken: _sessionToken!,
          center: _center,
        );
        if (mounted && requestId == _latestSuggestionRequest) {
          setState(() => _suggestions = suggestions);
        }
      } on ApiException catch (error) {
        debugPrint('Place suggestions failed: $error');
      }
    });
  }

  void _clearSuggestions() {
    _debounce?.cancel();
    _latestSuggestionRequest++;
    _suggestions = const [];
  }

  Future<void> _search(String query, {bool fitResults = true}) async {
    final text = query.trim();
    if (text.isEmpty) return;
    FocusScope.of(context).unfocus();
    final requestId = ++_latestPlaceRequest;
    setState(() {
      _clearSuggestions();
      _lastQuery = text;
      _sheet = _MapSheet.results;
      _results = const [];
      _isLoading = true;
      _showSearchArea = false;
    });
    try {
      final places = await ApiService.searchPlaces(text, center: _center);
      if (!mounted || requestId != _latestPlaceRequest) return;
      setState(() {
        _results = places;
        _isLoading = false;
      });
      if (fitResults) {
        _fitToCoordinates(_controller, [
          for (final place in places) LatLng(place.latitude, place.longitude),
        ]);
      }
    } on ApiException catch (error) {
      if (!mounted || requestId != _latestPlaceRequest) return;
      setState(() => _isLoading = false);
      _showMessage(error.message);
    }
  }

  // --- Places ---

  Future<void> _openPlace(String placeId, {String? sessionToken}) async {
    FocusScope.of(context).unfocus();
    final requestId = ++_latestPlaceRequest;
    setState(() {
      _clearSuggestions();
      _sheet = _MapSheet.place;
      _place = null;
      _isLoading = true;
    });
    try {
      final place = await ApiService.fetchPlace(placeId, sessionToken: sessionToken);
      if (!mounted || requestId != _latestPlaceRequest) return;
      setState(() {
        _place = place;
        _isLoading = false;
      });
      _fitToCoordinates(_controller, [LatLng(place.latitude, place.longitude)]);
    } on ApiException catch (error) {
      if (!mounted || requestId != _latestPlaceRequest) return;
      setState(() {
        _isLoading = false;
        _sheet = _placeFromResults ? _MapSheet.results : _MapSheet.none;
      });
      _showMessage(error.message);
    }
  }

  void _openSuggestion(PlaceSuggestion suggestion) {
    _searchController.text = suggestion.text;
    final token = _sessionToken;
    // Fetching the details ends the billing session the token belongs to.
    _sessionToken = null;
    _placeFromResults = false;
    _openPlace(suggestion.placeId, sessionToken: token);
  }

  void _openResult(MapPlace place) {
    final id = place.id;
    if (id == null) return;
    _placeFromResults = true;
    _openPlace(id);
  }

  Future<void> _showDroppedPin(LatLng position) async {
    final requestId = ++_latestPlaceRequest;
    final coordinates =
        '${position.latitude.toStringAsFixed(6)},${position.longitude.toStringAsFixed(6)}';
    final fallback = MapPlace(
      name: '已標記的位置',
      address: coordinates,
      latitude: position.latitude,
      longitude: position.longitude,
    );
    setState(() {
      _clearSuggestions();
      _placeFromResults = false;
      _sheet = _MapSheet.place;
      _place = fallback;
      _isLoading = false;
    });
    try {
      final address =
          await ApiService.reverseGeocode(position.latitude, position.longitude);
      if (!mounted || requestId != _latestPlaceRequest || address == null) return;
      setState(() {
        _place = MapPlace(
          name: address,
          address: coordinates,
          latitude: position.latitude,
          longitude: position.longitude,
        );
      });
    } on ApiException catch (error) {
      debugPrint('Reverse geocoding failed: $error');
    }
  }

  Future<void> _addToFootprint(MapPlace place) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CreateFootprintScreen(
          locate: widget.locate,
          initialStop: RouteStop(
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
          ),
        ),
      ),
    );
    if (saved != true) return;
    _footprintsChanged = true;
    _showMessage('足跡已儲存');
  }

  Future<void> _sharePlace(MapPlace place) async {
    await Clipboard.setData(
      ClipboardData(
        text: place.googleMapsUrl ??
            Uri.https('www.google.com', '/maps/search/', {
              'api': '1',
              'query': '${place.latitude},${place.longitude}',
            }).toString(),
      ),
    );
    _showMessage('已複製地點連結');
  }

  void _showStreetView(MapPlace place) {
    _openExternal(
      Uri.https('www.google.com', '/maps/@', {
        'api': '1',
        'map_action': 'pano',
        'viewpoint': '${place.latitude},${place.longitude}',
      }),
    );
  }

  void _searchNearby(MapPlace place) {
    final target = LatLng(place.latitude, place.longitude);
    _cameraTarget = target;
    _controller?.animateCamera(CameraUpdate.newLatLngZoom(target, 15));
    setState(() {
      _sheet = _MapSheet.none;
      _searchController.clear();
    });
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } on PlatformException catch (error) {
      debugPrint('Failed to open $uri: $error');
    }
    _showMessage('無法開啟 Google 地圖');
  }

  // --- Directions ---

  void _openDirections({String? destination}) {
    FocusScope.of(context).unfocus();
    setState(() {
      _clearSuggestions();
      if (destination != null) _destinationController.text = destination;
      _sheet = _MapSheet.directions;
    });
  }

  void _closeDirections() {
    setState(() {
      _sheet = _MapSheet.none;
      _routes = const [];
      _navigationUri = null;
    });
  }

  Map<String, dynamic> _waypoint(String text) => {'address': text};

  Future<void> _computeRoutes() async {
    final destination = _destinationController.text.trim();
    if (destination.isEmpty) {
      _showMessage('請輸入目的地');
      return;
    }
    FocusScope.of(context).unfocus();
    final intermediates = [
      for (final controller in _intermediateControllers)
        if (controller.text.trim().isNotEmpty) controller.text.trim(),
    ];
    setState(() {
      _isLoading = true;
      _routes = const [];
      _navigationUri = null;
    });
    try {
      final originText = _originController.text.trim();
      final Map<String, dynamic> origin;
      final String originParam;
      if (originText.isEmpty) {
        final here = await widget.locate();
        origin = {
          'location': {'latitude': here.latitude, 'longitude': here.longitude},
        };
        originParam = '${here.latitude},${here.longitude}';
      } else {
        origin = _waypoint(originText);
        originParam = originText;
      }
      final routes = await ApiService.computeRoutes({
        'origin': origin,
        'destination': _waypoint(destination),
        'intermediates': [for (final stop in intermediates) _waypoint(stop)],
        'travel_mode': _travelMode,
        'avoid_tolls': _avoidTolls,
        'avoid_highways': _avoidHighways,
        'avoid_ferries': _avoidFerries,
      });
      if (!mounted) return;
      setState(() {
        _routes = routes;
        _selectedRoute = 0;
        _navigationUri = Uri.https('www.google.com', '/maps/dir/', {
          'api': '1',
          'origin': originParam,
          'destination': destination,
          'travelmode': _travelMode.toLowerCase(),
          'dir_action': 'navigate',
          if (intermediates.isNotEmpty) 'waypoints': intermediates.join('|'),
        });
      });
      if (routes.isEmpty) {
        _showMessage('找不到可用的路線');
      } else {
        _fitToCoordinates(_controller, _routeCoordinates(routes.first));
      }
    } on LocationException catch (error) {
      _showMessage(error.message);
    } on ApiException catch (error) {
      _showMessage(error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _swapDirections() {
    final origin = _originController.text;
    _originController.text = _destinationController.text;
    _destinationController.text = origin;
  }

  void _setTravelMode(String mode) {
    setState(() {
      _travelMode = mode;
      // Transit routes cannot include intermediate stops.
      if (mode == 'TRANSIT') {
        for (final controller in _intermediateControllers) {
          controller.dispose();
        }
        _intermediateControllers.clear();
      }
    });
  }

  // Decoded once per route, because every rebuild draws every route.
  List<LatLng> _routeCoordinates(MapRoute route) => _routePaths[route] ??= [
        for (final (latitude, longitude) in decodePolyline(route.polyline))
          LatLng(latitude, longitude),
      ];

  // --- Map state ---

  Future<void> _goToMyLocation() async {
    try {
      final coordinates = await widget.locate();
      if (!mounted) return;
      setState(() => _myLocationEnabled = true);
      await _controller?.animateCamera(
        CameraUpdate.newLatLngZoom(
          LatLng(coordinates.latitude, coordinates.longitude),
          15,
        ),
      );
    } on LocationException catch (error) {
      _showMessage(error.message);
    } on TimeoutException {
      _showMessage('無法取得目前位置');
    }
  }

  void _openLayers() {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) {
          void update(VoidCallback change) {
            setState(change);
            setSheetState(() {});
          }

          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('地圖類型', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final MapEntry(key: type, value: label)
                          in _mapTypes.entries)
                        ChoiceChip(
                          label: Text(label),
                          selected: _mapType == type,
                          onSelected: (_) => update(() => _mapType = type),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('即時路況'),
                    value: _trafficEnabled,
                    onChanged: (value) => update(() => _trafficEnabled = value),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('3D 建築'),
                    value: _buildingsEnabled,
                    onChanged: (value) => update(() => _buildingsEnabled = value),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Set<Marker> get _allMarkers {
    final place = _place;
    return {
      if (_routes.isEmpty) ..._markers(widget.points),
      if (_sheet == _MapSheet.results || _placeFromResults)
        for (final result in _results)
          Marker(
            markerId: MarkerId('result:${result.id}'),
            position: LatLng(result.latitude, result.longitude),
            infoWindow: InfoWindow(title: result.name),
            onTap: () => _openResult(result),
          ),
      if (_sheet == _MapSheet.place && place != null)
        Marker(
          markerId: const MarkerId('place'),
          position: LatLng(place.latitude, place.longitude),
          infoWindow: InfoWindow(title: place.name),
        ),
    };
  }

  Set<Polyline> get _allPolylines => {
        if (_routes.isEmpty) ..._routeLines(widget.points),
        for (final (index, route) in _routes.indexed)
          Polyline(
            polylineId: PolylineId('route:$index'),
            points: _routeCoordinates(route),
            color: index == _selectedRoute
                ? const Color(0xFF1A73E8)
                : const Color(0xFF9AA5B1),
            width: index == _selectedRoute ? 6 : 5,
            zIndex: index == _selectedRoute ? 2 : 1,
            consumeTapEvents: true,
            onTap: () => setState(() => _selectedRoute = index),
          ),
      };

  // --- UI ---

  Widget _buildMap() {
    final override = widget.mapOverride;
    if (override != null) return override;
    return GoogleMap(
      initialCameraPosition: _taiwan,
      mapType: _mapType,
      trafficEnabled: _trafficEnabled,
      buildingsEnabled: _buildingsEnabled,
      myLocationEnabled: _myLocationEnabled,
      myLocationButtonEnabled: false,
      compassEnabled: true,
      mapToolbarEnabled: false,
      zoomControlsEnabled: false,
      markers: _allMarkers,
      polylines: _allPolylines,
      onMapCreated: (controller) {
        _controller = controller;
        _fitToCoordinates(controller, _stopCoordinates(widget.points));
      },
      onCameraMove: (position) => _cameraTarget = position.target,
      onCameraIdle: () {
        if (_sheet == _MapSheet.results && !_showSearchArea && !_isLoading) {
          setState(() => _showSearchArea = true);
        }
      },
      onTap: (_) {
        FocusScope.of(context).unfocus();
        setState(() {
          _clearSuggestions();
          if (_sheet == _MapSheet.place) {
            _sheet = _placeFromResults ? _MapSheet.results : _MapSheet.none;
          }
        });
      },
      onLongPress: _showDroppedPin,
    );
  }

  Widget _buildSearchBar() {
    return Material(
      elevation: 3,
      color: AppColors.card,
      borderRadius: BorderRadius.circular(24),
      child: Row(
        children: [
          IconButton(
            tooltip: '返回',
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.of(context).pop(_footprintsChanged),
          ),
          Expanded(
            child: TextField(
              controller: _searchController,
              textInputAction: TextInputAction.search,
              decoration: const InputDecoration(
                hintText: '搜尋 Google 地圖',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
              ),
              onChanged: _onSearchChanged,
              onSubmitted: _search,
            ),
          ),
          IconButton(
            tooltip: '規劃路線',
            icon: const Icon(Icons.directions, color: AppColors.accent),
            onPressed: _openDirections,
          ),
        ],
      ),
    );
  }

  Widget _buildSuggestions() {
    return Material(
      elevation: 3,
      color: AppColors.card,
      borderRadius: BorderRadius.circular(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final suggestion in _suggestions)
            ListTile(
              dense: true,
              leading: const Icon(Icons.place_outlined),
              title: Text(suggestion.text),
              subtitle: suggestion.secondaryText.isEmpty
                  ? null
                  : Text(suggestion.secondaryText),
              onTap: () => _openSuggestion(suggestion),
            ),
        ],
      ),
    );
  }

  Widget _buildChips() {
    return SizedBox(
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final chip in _searchChips)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ActionChip(
                label: Text(chip),
                onPressed: () {
                  _searchController.text = chip;
                  _search(chip, fitResults: false);
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSheet() {
    return DraggableScrollableSheet(
      key: ValueKey(_sheet),
      initialChildSize: 0.45,
      minChildSize: 0.15,
      maxChildSize: 0.92,
      builder: (context, scrollController) {
        return Material(
          elevation: 8,
          color: AppColors.card,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          clipBehavior: Clip.antiAlias,
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    color: AppColors.textMuted,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              if (_sheet == _MapSheet.directions)
                ..._buildDirections()
              else if (_isLoading)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_sheet == _MapSheet.results)
                ..._buildResults()
              else if (_place != null)
                ..._buildPlace(_place!),
            ],
          ),
        );
      },
    );
  }

  String _ratingText(MapPlace place) {
    final rating = place.rating;
    if (rating == null) return '';
    return '★ ${rating.toStringAsFixed(1)}（${place.ratingCount ?? 0}）';
  }

  List<Widget> _buildResults() {
    if (_results.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: Text('找不到符合的地點')),
        ),
      ];
    }
    return [
      for (final place in _results)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(place.name),
          subtitle: Text(
            [_ratingText(place), place.address ?? '']
                .where((text) => text.isNotEmpty)
                .join('\n'),
          ),
          onTap: () => _openResult(place),
        ),
    ];
  }

  Widget _placeAction(IconData icon, String label, VoidCallback onPressed) {
    return Expanded(
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: AppColors.field,
                child: Icon(icon, color: AppColors.accent, size: 20),
              ),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _buildPlace(MapPlace place) {
    final textTheme = Theme.of(context).textTheme;
    final openNow = place.openNow;
    final website = place.website;
    final phone = place.phone;
    final rating = _ratingText(place);
    return [
      Row(
        children: [
          if (_placeFromResults)
            IconButton(
              tooltip: '返回搜尋結果',
              icon: const Icon(Icons.arrow_back),
              onPressed: () => setState(() => _sheet = _MapSheet.results),
            ),
          Expanded(child: Text(place.name, style: textTheme.titleLarge)),
          IconButton(
            tooltip: '關閉',
            icon: const Icon(Icons.close),
            onPressed: () => setState(() {
              _sheet = _MapSheet.none;
              _placeFromResults = false;
            }),
          ),
        ],
      ),
      if (rating.isNotEmpty || openNow != null)
        Text(
          [rating, if (openNow != null) openNow ? '營業中' : '休息中']
              .where((text) => text.isNotEmpty)
              .join(' · '),
        ),
      const SizedBox(height: 10),
      Row(
        children: [
          _placeAction(
            Icons.directions,
            '路線',
            () => _openDirections(destination: place.address ?? place.name),
          ),
          _placeAction(Icons.add_location_alt_outlined, '加入足跡', () => _addToFootprint(place)),
          _placeAction(Icons.near_me_outlined, '附近', () => _searchNearby(place)),
          _placeAction(Icons.streetview, '街景', () => _showStreetView(place)),
          _placeAction(Icons.share_outlined, '分享', () => _sharePlace(place)),
        ],
      ),
      const Divider(height: 24),
      if (place.photos.isNotEmpty)
        SizedBox(
          height: 150,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final photo in place.photos)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Stack(
                    alignment: Alignment.bottomRight,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(
                          photo.url,
                          width: 220,
                          height: 150,
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) =>
                              const SizedBox(width: 220, height: 150),
                        ),
                      ),
                      if (photo.attributions.isNotEmpty)
                        Container(
                          color: Colors.black54,
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Text(
                            photo.attributions.join('、'),
                            style: const TextStyle(fontSize: 11, color: Colors.white),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      if (place.summary != null)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(place.summary!),
        ),
      if (place.address != null)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.place_outlined),
          title: Text(place.address!),
        ),
      if (phone != null)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.phone_outlined),
          title: Text(phone),
          onTap: () => _openExternal(
            Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^\d+]'), '')),
          ),
        ),
      if (website != null)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.public),
          title: const Text('網站'),
          onTap: () {
            final uri = Uri.tryParse(website);
            if (uri != null && (uri.isScheme('https') || uri.isScheme('http'))) {
              _openExternal(uri);
            }
          },
        ),
      if (place.hours.isNotEmpty)
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          leading: const Icon(Icons.schedule),
          title: const Text('營業時間'),
          children: [
            for (final line in place.hours)
              Align(alignment: Alignment.centerLeft, child: Text(line)),
          ],
        ),
      if (place.reviews.isNotEmpty) ...[
        const Divider(height: 24),
        Text('評論', style: textTheme.titleMedium),
        for (final review in place.reviews)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  [
                    review.author,
                    if (review.rating != null) '★ ${review.rating}',
                    review.time,
                  ].where((text) => text.isNotEmpty).join(' · '),
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                ),
                const SizedBox(height: 2),
                Text(review.text),
              ],
            ),
          ),
      ],
    ];
  }

  Widget _stopField(
    TextEditingController controller,
    String hint, {
    VoidCallback? onRemove,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              decoration: InputDecoration(hintText: hint, isDense: true),
            ),
          ),
          if (onRemove != null)
            IconButton(
              tooltip: '移除這一站',
              icon: const Icon(Icons.close),
              onPressed: onRemove,
            ),
        ],
      ),
    );
  }

  List<Widget> _buildDirections() {
    return [
      Row(
        children: [
          Expanded(
            child: Text('路線', style: Theme.of(context).textTheme.titleLarge),
          ),
          IconButton(
            tooltip: '關閉路線規劃',
            icon: const Icon(Icons.close),
            onPressed: _closeDirections,
          ),
        ],
      ),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final MapEntry(key: mode, value: (label, icon))
                in _travelModes.entries)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  avatar: Icon(icon, size: 18),
                  label: Text(label),
                  selected: _travelMode == mode,
                  onSelected: (_) => _setTravelMode(mode),
                ),
              ),
          ],
        ),
      ),
      const SizedBox(height: 12),
      _stopField(_originController, '起點（留空使用目前位置）'),
      for (final (index, controller) in _intermediateControllers.indexed)
        _stopField(
          controller,
          '第 ${index + 1} 個停靠站',
          onRemove: () => setState(() {
            _intermediateControllers.remove(controller);
            controller.dispose();
          }),
        ),
      _stopField(_destinationController, '目的地'),
      Row(
        children: [
          TextButton.icon(
            onPressed: _travelMode == 'TRANSIT' ||
                    _intermediateControllers.length >= _maxIntermediateStops
                ? null
                : () => setState(
                      () => _intermediateControllers.add(TextEditingController()),
                    ),
            icon: const Icon(Icons.add),
            label: const Text('新增停靠站'),
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: _swapDirections,
            icon: const Icon(Icons.swap_vert),
            label: const Text('對調'),
          ),
        ],
      ),
      if (_travelMode == 'DRIVING')
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: const Text('路線選項'),
          children: [
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('避開收費路段'),
              value: _avoidTolls,
              onChanged: (value) => setState(() => _avoidTolls = value ?? false),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('避開高速公路'),
              value: _avoidHighways,
              onChanged: (value) => setState(() => _avoidHighways = value ?? false),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('避開渡輪'),
              value: _avoidFerries,
              onChanged: (value) => setState(() => _avoidFerries = value ?? false),
            ),
          ],
        ),
      const SizedBox(height: 8),
      FilledButton(
        onPressed: _isLoading ? null : _computeRoutes,
        child: Text(_isLoading ? '查詢中…' : '查詢路線'),
      ),
      const SizedBox(height: 8),
      for (final (index, route) in _routes.indexed) _buildRouteCard(index, route),
    ];
  }

  Widget _buildRouteCard(int index, MapRoute route) {
    final isSelected = index == _selectedRoute;
    final navigationUri = _navigationUri;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: isSelected ? AppColors.accent : AppColors.outline,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(formatRouteDuration(route.durationSeconds)),
              subtitle: route.description.isEmpty ? null : Text(route.description),
              trailing: Text(formatRouteDistance(route.distanceMeters)),
              onTap: () => setState(() => _selectedRoute = index),
            ),
            if (isSelected) ...[
              if (navigationUri != null)
                FilledButton.icon(
                  onPressed: () => _openExternal(navigationUri),
                  icon: const Icon(Icons.navigation_outlined),
                  label: const Text('開始導航'),
                ),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text('路線步驟（${route.steps.length}）'),
                children: [
                  for (final step in route.steps)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        [
                          if (step.transitLine != null)
                            step.headsign == null
                                ? step.transitLine!
                                : '${step.transitLine} 往 ${step.headsign}',
                          if (step.instruction.isNotEmpty) step.instruction,
                        ].join('\n'),
                      ),
                      subtitle: Text(formatRouteDistance(step.distanceMeters)),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<bool>(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_footprintsChanged);
      },
      child: Scaffold(
        body: Stack(
          children: [
            Positioned.fill(child: _buildMap()),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _buildSearchBar(),
                    const SizedBox(height: 8),
                    if (_suggestions.isNotEmpty)
                      _buildSuggestions()
                    else ...[
                      _buildChips(),
                      if (_showSearchArea && _sheet == _MapSheet.results)
                        Center(
                          child: FilledButton.tonal(
                            onPressed: () => _search(_lastQuery, fitResults: false),
                            child: const Text('搜尋這個區域'),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
            if (_sheet == _MapSheet.none)
              Positioned(
                right: 12,
                bottom: 32,
                child: Column(
                  children: [
                    FloatingActionButton.small(
                      heroTag: 'map-layers',
                      tooltip: '圖層',
                      onPressed: _openLayers,
                      child: const Icon(Icons.layers_outlined),
                    ),
                    const SizedBox(height: 8),
                    FloatingActionButton.small(
                      heroTag: 'map-location',
                      tooltip: '我的位置',
                      onPressed: _goToMyLocation,
                      child: const Icon(Icons.my_location),
                    ),
                    const SizedBox(height: 8),
                    FloatingActionButton(
                      heroTag: 'map-directions',
                      tooltip: '規劃路線',
                      onPressed: _openDirections,
                      child: const Icon(Icons.directions),
                    ),
                  ],
                ),
              )
            else
              Positioned.fill(child: _buildSheet()),
          ],
        ),
      ),
    );
  }
}
