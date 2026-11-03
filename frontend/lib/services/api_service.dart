import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;
import 'package:life_logger/models/map_place.dart';
import 'package:life_logger/models/user_profile.dart';
import 'package:life_logger/services/location_service.dart' show Coordinates;

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class ApiService {
  static const _configuredBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const _sessionCookieName = 'life_logger_session';
  static const _sessionStorageKey = 'session_token';
  static const _requestTimeout = Duration(seconds: 20);
  static const _storage = FlutterSecureStorage();

  static http.Client client = http.Client();

  /// Opens the provider's sign-in page and returns the URL it redirected back to.
  static Future<String> Function(String url) openAuthSession = (url) {
    return FlutterWebAuth2.authenticate(
      url: url,
      callbackUrlScheme: 'lifelogger',
    );
  };

  /// The signed-in user; null sends the app back to the login screen.
  static final currentUser = ValueNotifier<AppUser?>(null);

  static String? _sessionToken;

  static String get baseUrl {
    if (_configuredBaseUrl.isNotEmpty) return _configuredBaseUrl;
    // The Android emulator reaches the host machine through this alias.
    final host =
        defaultTargetPlatform == TargetPlatform.android ? '10.0.2.2' : '127.0.0.1';
    return 'http://$host:8000/api';
  }

  static Future<void> restoreSession() async {
    try {
      _sessionToken = await _storage.read(key: _sessionStorageKey);
    } on PlatformException catch (error) {
      debugPrint('Failed to read stored session: $error');
    }
    if (_sessionToken == null) return;
    try {
      final data = await _request('GET', '/auth/me') as Map<String, dynamic>;
      currentUser.value = AppUser.fromJson(data['user']);
    } on ApiException catch (error) {
      // A 401 has already cleared the session; anything else can be retried.
      if (error.statusCode != 401) rethrow;
    }
  }

  static Future<void> login({
    required String email,
    required String password,
  }) async {
    await _authenticate('/auth/login', {'email': email, 'password': password});
  }

  /// Returns false when the account must confirm its email before signing in.
  static Future<bool> register({
    required String email,
    required String password,
    required String displayName,
  }) {
    return _authenticate('/auth/register', {
      'email': email,
      'password': password,
      'display_name': displayName,
    });
  }

  static Future<void> resendVerification(String email) async {
    await _request(
      'POST',
      '/auth/resend-verification',
      body: {'email': email},
    );
  }

  static Future<Map<String, dynamic>> fetchAuthProviders() async {
    return await _request('GET', '/auth/providers') as Map<String, dynamic>;
  }

  /// Returns false when the user closed the provider's sign-in page.
  static Future<bool> signInWithProvider(String provider) async {
    final random = Random.secure();
    final verifier = _base64Url(List.generate(48, (_) => random.nextInt(256)));
    final challenge = _base64Url(sha256.convert(utf8.encode(verifier)).bytes);
    final url = Uri.parse('$baseUrl/auth/$provider').replace(
      queryParameters: {'app_challenge': challenge},
    );

    final String callback;
    try {
      callback = await openAuthSession(url.toString());
    } on PlatformException catch (error) {
      if (error.code == 'CANCELED') return false;
      debugPrint('Failed to open sign-in page: $error');
      throw const ApiException('無法開啟登入頁面，請稍後再試');
    }

    final result = Uri.parse(callback).queryParameters;
    final code = result['code'];
    if (code == null) {
      throw ApiException(result['error'] ?? '第三方登入未完成，請重試');
    }
    return _authenticate(
      '/auth/app-exchange',
      {'code': code, 'verifier': verifier},
    );
  }

  static Future<void> logout() async {
    try {
      await _request('POST', '/auth/logout');
    } on ApiException catch (error) {
      debugPrint('Failed to revoke session on the server: $error');
    } finally {
      await _clearSession();
    }
  }

  static Future<List<dynamic>> fetchEntries() async {
    return await _request('GET', '/entries') as List<dynamic>;
  }

  static Future<List<dynamic>> fetchLocations() async {
    return await _request('GET', '/map-points') as List<dynamic>;
  }

  static Future<Map<String, dynamic>> fetchDashboard() async {
    return await _request('GET', '/dashboard') as Map<String, dynamic>;
  }

  static Future<UserProfile> fetchProfile() async {
    final data = await _request('GET', '/user/profile');
    return UserProfile.fromJson(data as Map<String, dynamic>);
  }

  static Future<Map<String, dynamic>> createEntry(
    Map<String, dynamic> payload,
  ) async {
    return await _request('POST', '/entries', body: payload)
        as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> createMapPoint(
    Map<String, dynamic> payload,
  ) async {
    return await _request('POST', '/map-points', body: payload)
        as Map<String, dynamic>;
  }

  static String _base64Url(List<int> bytes) {
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  static Future<List<PlaceSuggestion>> fetchPlaceSuggestions(
    String query, {
    required String sessionToken,
    Coordinates? center,
  }) async {
    final data = await _request(
      'POST',
      '/maps/autocomplete',
      body: {
        'query': query,
        'session_token': sessionToken,
        if (center != null) 'center': _centerJson(center),
      },
    ) as List<dynamic>;
    return [for (final item in data) PlaceSuggestion.fromJson(item)];
  }

  static Future<List<MapPlace>> searchPlaces(
    String query, {
    Coordinates? center,
  }) async {
    final data = await _request(
      'POST',
      '/maps/search',
      body: {
        'query': query,
        if (center != null) 'center': _centerJson(center),
      },
    ) as List<dynamic>;
    return [for (final item in data) MapPlace.fromJson(item)];
  }

  static Future<MapPlace> fetchPlace(String placeId, {String? sessionToken}) async {
    final query = sessionToken == null
        ? ''
        : '?${Uri(queryParameters: {'session_token': sessionToken}).query}';
    final data = await _request(
      'GET',
      '/maps/places/${Uri.encodeComponent(placeId)}$query',
    );
    return MapPlace.fromJson(data);
  }

  static Future<String?> reverseGeocode(double latitude, double longitude) async {
    final data = await _request(
      'GET',
      '/maps/reverse-geocode?latitude=$latitude&longitude=$longitude',
    );
    return data['address'];
  }

  static Future<List<MapRoute>> computeRoutes(Map<String, dynamic> request) async {
    final data = await _request('POST', '/maps/routes', body: request) as List<dynamic>;
    return [for (final item in data) MapRoute.fromJson(item)];
  }

  static Map<String, double> _centerJson(
    Coordinates center,
  ) {
    return {'latitude': center.latitude, 'longitude': center.longitude};
  }

  static Future<bool> _authenticate(
    String path,
    Map<String, dynamic> credentials,
  ) async {
    final data = await _request(
      'POST',
      path,
      body: credentials,
      onResponse: _captureSessionCookie,
    ) as Map<String, dynamic>;
    if (data['verification_required'] == true) return false;
    if (_sessionToken == null) {
      throw const ApiException('伺服器未回傳登入狀態，請稍後再試');
    }
    try {
      await _storage.write(key: _sessionStorageKey, value: _sessionToken);
    } on PlatformException catch (error) {
      // The session still works until the app closes.
      debugPrint('Failed to store session: $error');
    }
    currentUser.value = AppUser.fromJson(data['user']);
    return true;
  }

  static void _captureSessionCookie(http.Response response) {
    final cookies = response.headers['set-cookie'];
    if (cookies == null) return;
    final match = RegExp('$_sessionCookieName=([^;,\\s]+)').firstMatch(cookies);
    if (match != null) _sessionToken = match.group(1);
  }

  static Future<void> _clearSession() async {
    _sessionToken = null;
    currentUser.value = null;
    try {
      await _storage.delete(key: _sessionStorageKey);
    } on PlatformException catch (error) {
      debugPrint('Failed to delete stored session: $error');
    }
  }

  static Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    void Function(http.Response)? onResponse,
  }) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    if (_sessionToken != null) {
      request.headers['Cookie'] = '$_sessionCookieName=$_sessionToken';
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await client.send(request).timeout(_requestTimeout),
      ).timeout(_requestTimeout);
    } on TimeoutException {
      throw const ApiException('伺服器回應逾時，請稍後再試');
    } on http.ClientException {
      throw const ApiException('無法連線到伺服器，請確認網路與後端服務');
    }

    final decoded = _decodeBody(response);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      onResponse?.call(response);
      return decoded;
    }

    // A rejected login is not an expired session, so it must not sign anyone out.
    if (response.statusCode == 401 && !path.startsWith('/auth/login')) {
      await _clearSession();
    }
    throw ApiException(
      _errorMessage(decoded, response.statusCode),
      statusCode: response.statusCode,
    );
  }

  static dynamic _decodeBody(http.Response response) {
    if (response.bodyBytes.isEmpty) return null;
    try {
      // FastAPI sends UTF-8 JSON without a charset parameter.
      return jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      return null;
    }
  }

  static String _errorMessage(dynamic decoded, int statusCode) {
    final detail = decoded is Map<String, dynamic> ? decoded['detail'] : null;
    if (detail is String && detail.isNotEmpty) return detail;
    if (detail is List && detail.isNotEmpty) {
      final first = detail.first;
      if (first is Map<String, dynamic> && first['msg'] is String) {
        return first['msg'] as String;
      }
    }
    return '伺服器回應錯誤（HTTP $statusCode）';
  }
}
