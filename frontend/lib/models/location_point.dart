class RouteStop {
  final String name;
  final double latitude;
  final double longitude;

  const RouteStop({
    required this.name,
    required this.latitude,
    required this.longitude,
  });
}

/// Google allows nine waypoints in a Maps URL.
const _maxWaypoints = 9;

class LocationPoint {
  final int id;
  final String name;
  final double? latitude;
  final double? longitude;
  final String? note;
  final String createdAt;
  final bool isOwner;
  final List<RouteStop> stops;

  /// Every stop in order, as text Google Maps can find: coordinates or a name.
  final List<String> mapQueries;

  LocationPoint({
    required this.id,
    required this.name,
    this.latitude,
    this.longitude,
    this.note,
    required this.createdAt,
    this.isOwner = true,
    this.stops = const [],
    this.mapQueries = const [],
  });

  /// Opens the stops in Google Maps; null when there is nothing to look up.
  Uri? get googleMapsUri {
    if (mapQueries.isEmpty) return null;
    if (mapQueries.length == 1) {
      return Uri.https('www.google.com', '/maps/search/', {
        'api': '1',
        'query': mapQueries.single,
      });
    }
    final waypoints = mapQueries.sublist(1, mapQueries.length - 1).take(_maxWaypoints);
    return Uri.https('www.google.com', '/maps/dir/', {
      'api': '1',
      'origin': mapQueries.first,
      'destination': mapQueries.last,
      if (waypoints.isNotEmpty) 'waypoints': waypoints.join('|'),
    });
  }

  factory LocationPoint.fromJson(Map<String, dynamic> json) {
    final rawStops = json['points'] as List<dynamic>? ?? const [];
    return LocationPoint(
      id: json['id'] ?? 0,
      name: json['name'] ?? '',
      latitude: json['latitude'] != null ? (json['latitude'] as num).toDouble() : null,
      longitude: json['longitude'] != null ? (json['longitude'] as num).toDouble() : null,
      note: json['note'],
      createdAt: json['created_at'] ?? '',
      isOwner: json['is_owner'] ?? true,
      stops: [
        for (final stop in rawStops)
          if (stop['lat'] != null && stop['lng'] != null)
            RouteStop(
              name: stop['name'] ?? json['name'] ?? '',
              latitude: (stop['lat'] as num).toDouble(),
              longitude: (stop['lng'] as num).toDouble(),
            ),
      ],
      mapQueries: [
        for (final stop in rawStops)
          if (stop['lat'] != null && stop['lng'] != null)
            '${stop['lat']},${stop['lng']}'
          else if ('${stop['name'] ?? ''}'.trim().isNotEmpty)
            '${stop['name']}'.trim(),
        if (rawStops.isEmpty && json['latitude'] != null && json['longitude'] != null)
          '${json['latitude']},${json['longitude']}',
      ],
    );
  }
}
