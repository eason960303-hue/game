import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:life_logger/models/location_point.dart';
import 'package:life_logger/screens/footprint_map_screen.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/utils/map_format.dart';

http.Response jsonResponse(Object body) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), 200);

const placeSummary = {
  'id': 'p1',
  'name': '阿宗麵線',
  'address': '台北市萬華區',
  'latitude': 25.04,
  'longitude': 121.5,
  'rating': 4.4,
  'rating_count': 100,
};

void main() {
  group('map_format', () {
    test('decodes Google\'s reference polyline', () {
      expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
        (38.5, -120.2),
        (40.7, -120.95),
        (43.252, -126.453),
      ]);
    });

    test('ignores a truncated polyline instead of throwing', () {
      expect(decodePolyline('_p~iF'), isEmpty);
    });

    test('formats durations and distances', () {
      expect(formatRouteDuration(1680), '28 分鐘');
      expect(formatRouteDuration(7200), '2 小時');
      expect(formatRouteDuration(4500), '1 小時 15 分鐘');
      expect(formatRouteDuration(0), '1 分鐘');
      expect(formatRouteDistance(800), '800 公尺');
      expect(formatRouteDistance(12300), '12.3 公里');
    });
  });

  test('LocationPoint reads route stops and skips incomplete ones', () {
    final point = LocationPoint.fromJson({
      'id': 1,
      'name': '旗津',
      'created_at': '',
      'points': [
        {'name': '渡輪站', 'lat': 22.6, 'lng': 120.2},
        {'name': '壞資料'},
      ],
    });
    expect(point.stops.map((stop) => stop.name), ['渡輪站']);
  });

  group('LocationPoint.googleMapsUri', () {
    LocationPoint parse(List<Map<String, dynamic>> stops) => LocationPoint.fromJson({
          'id': 1,
          'name': '路線',
          'created_at': '',
          'latitude': null,
          'longitude': null,
          'points': stops,
        });

    test('searches for a single stop by name', () {
      final point = parse([
        {'name': '駁二藝術特區', 'lat': null, 'lng': null},
      ]);
      expect(point.stops, isEmpty);
      final uri = point.googleMapsUri!;
      expect(uri.path, '/maps/search/');
      expect(uri.queryParameters['query'], '駁二藝術特區');
    });

    test('routes through stops in order, preferring coordinates', () {
      final uri = parse([
        {'name': '目前位置', 'lat': 22.6, 'lng': 120.2},
        {'name': '駁二藝術特區'},
        {'name': '星空隧道'},
      ]).googleMapsUri!;
      expect(uri.path, '/maps/dir/');
      expect(uri.queryParameters['origin'], '22.6,120.2');
      expect(uri.queryParameters['waypoints'], '駁二藝術特區');
      expect(uri.queryParameters['destination'], '星空隧道');
    });

    test('keeps the destination when there are too many waypoints', () {
      final uri = parse([
        for (var index = 0; index < 13; index++) {'name': '站$index'},
      ]).googleMapsUri!;
      expect(uri.queryParameters['waypoints']!.split('|'), hasLength(9));
      expect(uri.queryParameters['destination'], '站12');
    });

    test('falls back to a legacy point and is null with no location', () {
      final legacy = LocationPoint.fromJson({
        'id': 1,
        'name': '舊足跡',
        'created_at': '',
        'latitude': 22.6,
        'longitude': 120.2,
      });
      expect(legacy.googleMapsUri!.queryParameters['query'], '22.6,120.2');
      expect(
        LocationPoint(id: 2, name: '空', createdAt: '').googleMapsUri,
        isNull,
      );
    });
  });

  group('FootprintMapScreen', () {
    late List<http.Request> requests;

    Future<void> pumpScreen(WidgetTester tester) async {
      requests = [];
      ApiService.client = MockClient((request) async {
        requests.add(request);
        final path = request.url.path;
        if (path.endsWith('/maps/autocomplete')) {
          return jsonResponse([
            {'place_id': 'p1', 'text': '阿宗麵線', 'secondary_text': '西門町'},
          ]);
        }
        if (path.endsWith('/maps/search')) return jsonResponse([placeSummary]);
        if (path.endsWith('/maps/places/p1')) {
          return jsonResponse({
            ...placeSummary,
            'open_now': true,
            'phone': '02 2388 8808',
            'reviews': [
              {'author': '小林', 'rating': 5, 'text': '好吃', 'time': '1 週前'},
            ],
          });
        }
        if (path.endsWith('/maps/routes')) {
          return jsonResponse([
            {
              'description': '國道1號',
              'distance_meters': 12300,
              'duration_seconds': 1680,
              'polyline': '_p~iF~ps|U_ulLnnqC',
              'steps': [
                {'instruction': '向北直行', 'distance_meters': 500},
              ],
            },
          ]);
        }
        return http.Response('not found', 404);
      });
      tester.view.physicalSize = const Size(800, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.dark,
          home: FootprintMapScreen(
            points: const [],
            locate: () async => (latitude: 25.0, longitude: 121.0),
            mapOverride: const SizedBox.expand(),
          ),
        ),
      );
    }

    testWidgets('a suggestion opens the place with its session token', (tester) async {
      await pumpScreen(tester);
      await tester.enterText(find.byType(TextField), '阿宗');
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();

      expect(find.text('西門町'), findsOneWidget);
      final token = jsonDecode(requests.single.body)['session_token'] as String;
      await tester.tap(find.text('西門町'));
      await tester.pumpAndSettle();

      expect(find.textContaining('營業中'), findsOneWidget);
      expect(find.text('好吃'), findsOneWidget);
      expect(requests.last.url.queryParameters['session_token'], token);
    });

    testWidgets('search results lead to a place and back', (tester) async {
      await pumpScreen(tester);
      await tester.tap(find.text('餐廳'));
      await tester.pumpAndSettle();

      expect(jsonDecode(requests.single.body)['query'], '餐廳');
      await tester.tap(find.text('阿宗麵線'));
      await tester.pumpAndSettle();
      expect(find.text('加入足跡'), findsOneWidget);

      await tester.tap(find.byTooltip('返回搜尋結果'));
      await tester.pumpAndSettle();
      expect(find.text('加入足跡'), findsNothing);
      expect(find.text('阿宗麵線'), findsOneWidget);
    });

    testWidgets('directions default to the current location', (tester) async {
      await pumpScreen(tester);
      await tester.tap(find.byTooltip('規劃路線').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, '目的地'), '板橋');
      await tester.tap(find.text('查詢路線'));
      await tester.pumpAndSettle();

      final body = jsonDecode(requests.single.body);
      expect(body['origin']['location'], {'latitude': 25.0, 'longitude': 121.0});
      expect(body['destination'], {'address': '板橋'});
      expect(body['travel_mode'], 'DRIVING');
      expect(find.text('28 分鐘'), findsOneWidget);
      expect(find.text('開始導航'), findsOneWidget);
    });

    testWidgets('transit removes intermediate stops', (tester) async {
      await pumpScreen(tester);
      await tester.tap(find.byTooltip('規劃路線').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('新增停靠站'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, '第 1 個停靠站'), findsOneWidget);

      await tester.tap(find.text('大眾運輸'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, '第 1 個停靠站'), findsNothing);
    });
  });
}
