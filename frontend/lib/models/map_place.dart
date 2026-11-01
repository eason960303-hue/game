class PlaceSuggestion {
  final String placeId;
  final String text;
  final String secondaryText;

  const PlaceSuggestion({
    required this.placeId,
    required this.text,
    this.secondaryText = '',
  });

  factory PlaceSuggestion.fromJson(Map<String, dynamic> json) {
    return PlaceSuggestion(
      placeId: json['place_id'] ?? '',
      text: json['text'] ?? '',
      secondaryText: json['secondary_text'] ?? '',
    );
  }
}

class PlaceReview {
  final String author;
  final num? rating;
  final String text;
  final String time;

  const PlaceReview({
    required this.author,
    this.rating,
    this.text = '',
    this.time = '',
  });

  factory PlaceReview.fromJson(Map<String, dynamic> json) {
    return PlaceReview(
      author: json['author'] ?? '',
      rating: json['rating'],
      text: json['text'] ?? '',
      time: json['time'] ?? '',
    );
  }
}

class PlacePhoto {
  final String url;
  final List<String> attributions;

  const PlacePhoto({required this.url, this.attributions = const []});

  factory PlacePhoto.fromJson(Map<String, dynamic> json) {
    return PlacePhoto(
      url: json['url'] ?? '',
      attributions: [
        for (final name in (json['attributions'] as List<dynamic>? ?? const []))
          '$name',
      ],
    );
  }
}

class MapPlace {
  final String? id;
  final String name;
  final String? address;
  final double latitude;
  final double longitude;
  final double? rating;
  final int? ratingCount;
  final String? phone;
  final String? website;
  final String? googleMapsUrl;
  final String? summary;
  final bool? openNow;
  final List<String> hours;
  final List<PlacePhoto> photos;
  final List<PlaceReview> reviews;

  const MapPlace({
    this.id,
    required this.name,
    this.address,
    required this.latitude,
    required this.longitude,
    this.rating,
    this.ratingCount,
    this.phone,
    this.website,
    this.googleMapsUrl,
    this.summary,
    this.openNow,
    this.hours = const [],
    this.photos = const [],
    this.reviews = const [],
  });

  factory MapPlace.fromJson(Map<String, dynamic> json) {
    return MapPlace(
      id: json['id'],
      name: json['name'] ?? '',
      address: json['address'],
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      rating: (json['rating'] as num?)?.toDouble(),
      ratingCount: json['rating_count'],
      phone: json['phone'],
      website: json['website'],
      googleMapsUrl: json['google_maps_url'],
      summary: json['summary'],
      openNow: json['open_now'],
      hours: [
        for (final line in (json['hours'] as List<dynamic>? ?? const [])) '$line',
      ],
      photos: [
        for (final photo in (json['photos'] as List<dynamic>? ?? const []))
          PlacePhoto.fromJson(photo),
      ],
      reviews: [
        for (final review in (json['reviews'] as List<dynamic>? ?? const []))
          PlaceReview.fromJson(review),
      ],
    );
  }
}

class RouteStep {
  final String instruction;
  final int distanceMeters;
  final String? transitLine;
  final String? headsign;

  const RouteStep({
    required this.instruction,
    required this.distanceMeters,
    this.transitLine,
    this.headsign,
  });

  factory RouteStep.fromJson(Map<String, dynamic> json) {
    return RouteStep(
      instruction: json['instruction'] ?? '',
      distanceMeters: json['distance_meters'] ?? 0,
      transitLine: json['transit_line'],
      headsign: json['headsign'],
    );
  }
}

class MapRoute {
  final String description;
  final int distanceMeters;
  final int durationSeconds;
  final String polyline;
  final List<RouteStep> steps;

  const MapRoute({
    required this.description,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.polyline,
    this.steps = const [],
  });

  factory MapRoute.fromJson(Map<String, dynamic> json) {
    return MapRoute(
      description: json['description'] ?? '',
      distanceMeters: json['distance_meters'] ?? 0,
      durationSeconds: json['duration_seconds'] ?? 0,
      polyline: json['polyline'] ?? '',
      steps: [
        for (final step in (json['steps'] as List<dynamic>? ?? const []))
          RouteStep.fromJson(step),
      ],
    );
  }
}
