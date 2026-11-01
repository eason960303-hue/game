import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:life_logger/main.dart';
import 'package:life_logger/screens/create_entry_screen.dart';
import 'package:life_logger/screens/create_footprint_screen.dart';
import 'package:life_logger/screens/home_screen.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/services/location_service.dart';
import 'package:life_logger/theme/app_theme.dart';

http.Response jsonResponse(Object body, {int status = 200}) {
  return http.Response.bytes(utf8.encode(jsonEncode(body)), status);
}

const stopHint = '地點名稱或地址，例如：旗津海岸公園';

Widget themed(Widget child) => MaterialApp(theme: AppTheme.dark, home: child);

Future<void> useSmallPhone(WidgetTester tester) async {
  tester.view.physicalSize = const Size(320, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<http.Response> Function(http.Request) backendHandler({
  List<Map<String, dynamic>> entries = const [],
  List<Map<String, dynamic>> points = const [],
}) {
  return (request) async {
    final path = request.url.path;
    if (path.endsWith('/entries')) return jsonResponse(entries);
    if (path.endsWith('/map-points')) return jsonResponse(points);
    if (path.endsWith('/user/profile')) {
      return jsonResponse({
        'display_name': '小明',
        'bio': '',
        'followers_count': 2,
        'following_count': 3,
      });
    }
    return jsonResponse({
      'entry_count': entries.length,
      'latest_entry': entries.isEmpty ? null : entries.first,
    });
  };
}

MockClient backend({
  List<Map<String, dynamic>> entries = const [],
  List<Map<String, dynamic>> points = const [],
}) {
  return MockClient(backendHandler(entries: entries, points: points));
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    ApiService.currentUser.value = null;
  });

  group('AuthGate', () {
    testWidgets('shows login without a stored session', (tester) async {
      ApiService.client = backend();
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      expect(find.text('登入'), findsOneWidget);
    });

    testWidgets('logging in opens home and logging out returns', (tester) async {
      final home = backendHandler();
      ApiService.client = MockClient((request) async {
        if (request.url.path.endsWith('/auth/login')) {
          return http.Response.bytes(
            utf8.encode(jsonEncode({
              'authenticated': true,
              'user': {'id': 1, 'email': 'a@example.com', 'display_name': '小明'},
            })),
            200,
            headers: {'set-cookie': 'life_logger_session=abc; Path=/'},
          );
        }
        return home(request);
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).at(0), 'a@example.com');
      await tester.enterText(find.byType(TextFormField).at(1), 'password1');
      await tester.tap(find.widgetWithText(FilledButton, '登入'));
      await tester.pumpAndSettle();

      expect(find.byType(HomeScreen), findsOneWidget);

      await tester.tap(find.text('我的'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('登出'), 200);
      await tester.tap(find.text('登出'));
      await tester.pumpAndSettle();

      expect(find.byType(HomeScreen), findsNothing);
      expect(find.widgetWithText(FilledButton, '登入'), findsOneWidget);
    });

    testWidgets('login form validates before calling the server', (tester) async {
      var calls = 0;
      ApiService.client = MockClient((request) async {
        if (request.url.path.endsWith('/auth/login')) calls++;
        return jsonResponse({});
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilledButton, '登入'));
      await tester.pump();

      expect(find.text('請輸入有效的電子郵件'), findsOneWidget);
      expect(find.text('請輸入密碼'), findsOneWidget);
      expect(calls, 0);
    });

    testWidgets('switching to register keeps the email', (tester) async {
      ApiService.client = backend();
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).at(0), 'a@example.com');
      await tester.tap(find.text('還沒有帳號？註冊'));
      await tester.pumpAndSettle();

      expect(find.text('a@example.com'), findsOneWidget);
      expect(find.text('顯示名稱'), findsOneWidget);
    });
  });

  group('LoginScreen', () {
    Future<void> fillAndSubmit(WidgetTester tester, {bool register = false}) async {
      if (register) {
        await tester.tap(find.text('還沒有帳號？註冊'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextFormField).at(0), '小明');
      }
      final offset = register ? 1 : 0;
      await tester.enterText(
        find.byType(TextFormField).at(offset),
        'a@example.com',
      );
      await tester.enterText(
        find.byType(TextFormField).at(offset + 1),
        'password123',
      );
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
    }

    testWidgets('hides provider buttons the server has not configured', (tester) async {
      ApiService.client = MockClient((_) async {
        return jsonResponse({'google': false, 'apple': false});
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      expect(find.text('使用 Google 登入'), findsNothing);
      expect(find.text('使用 Apple 登入'), findsNothing);
    });

    testWidgets('registration asks for email verification', (tester) async {
      var resent = 0;
      ApiService.client = MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/auth/register')) {
          return jsonResponse({
            'authenticated': false,
            'verification_required': true,
            'email': 'a@example.com',
          }, status: 202);
        }
        if (path.endsWith('/auth/resend-verification')) {
          resent++;
          return jsonResponse({'sent': true});
        }
        return jsonResponse({});
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await fillAndSubmit(tester, register: true);

      expect(find.byType(HomeScreen), findsNothing);
      expect(find.textContaining('驗證信已寄到 a@example.com'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, '登入'), findsOneWidget);

      await tester.tap(find.text('重新寄送驗證信'));
      await tester.pumpAndSettle();
      expect(resent, 1);
    });

    testWidgets('an unverified login offers to resend the email', (tester) async {
      ApiService.client = MockClient((request) async {
        if (request.url.path.endsWith('/auth/login')) {
          return jsonResponse({'detail': '請先到信箱完成電子郵件驗證'}, status: 403);
        }
        return jsonResponse({});
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await fillAndSubmit(tester);

      expect(find.text('請先到信箱完成電子郵件驗證'), findsOneWidget);
      expect(find.text('重新寄送驗證信'), findsOneWidget);
    });

    testWidgets('provider sign-in redeems the code with a matching PKCE verifier', (tester) async {
      String? openedUrl;
      Map<String, dynamic>? exchange;
      addTearDown(() => ApiService.openAuthSession = (_) async => '');
      ApiService.openAuthSession = (url) async {
        openedUrl = url;
        return 'lifelogger://auth?code=one-time';
      };
      final home = backendHandler();
      ApiService.client = MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/auth/providers')) {
          return jsonResponse({'google': true, 'apple': true});
        }
        if (path.endsWith('/auth/app-exchange')) {
          exchange = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response.bytes(
            utf8.encode(jsonEncode({
              'authenticated': true,
              'user': {'id': 7, 'email': 'g@example.com', 'display_name': 'G'},
            })),
            200,
            headers: {'set-cookie': 'life_logger_session=oauth; Path=/'},
          );
        }
        return home(request);
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('使用 Google 登入'));
      await tester.pumpAndSettle();

      final challenge = Uri.parse(openedUrl!).queryParameters['app_challenge']!;
      final verifier = exchange!['verifier'] as String;
      expect(openedUrl, contains('/auth/google?'));
      expect(challenge, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
      expect(
        base64UrlEncode(sha256.convert(utf8.encode(verifier)).bytes).replaceAll('=', ''),
        challenge,
      );
      expect(verifier.length, greaterThanOrEqualTo(43));
      expect(exchange!['code'], 'one-time');
      expect(find.byType(HomeScreen), findsOneWidget);
    });

    testWidgets('closing the provider page stays quiet on login', (tester) async {
      addTearDown(() => ApiService.openAuthSession = (_) async => '');
      ApiService.openAuthSession = (_) async {
        throw PlatformException(code: 'CANCELED');
      };
      ApiService.client = MockClient((_) async {
        return jsonResponse({'google': true, 'apple': false});
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('使用 Google 登入'));
      await tester.pumpAndSettle();

      expect(find.byType(HomeScreen), findsNothing);
      expect(find.text('使用 Google 登入'), findsOneWidget);
      expect(find.textContaining('失敗'), findsNothing);
    });

    testWidgets('a provider error from the server is shown', (tester) async {
      addTearDown(() => ApiService.openAuthSession = (_) async => '');
      ApiService.openAuthSession = (_) async {
        return 'lifelogger://auth?error=%E7%AC%AC%E4%B8%89%E6%96%B9%E5%B8%B3%E8%99%9F%E5%B0%9A%E6%9C%AA%E9%A9%97%E8%AD%89';
      };
      ApiService.client = MockClient((_) async {
        return jsonResponse({'google': true, 'apple': false});
      });
      await tester.pumpWidget(const LifeLoggerApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('使用 Google 登入'));
      await tester.pumpAndSettle();

      expect(find.text('第三方帳號尚未驗證'), findsOneWidget);
    });
  });

  group('CreateFootprintScreen', () {
    void useTallWindow(WidgetTester tester) {
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
    }

    testWidgets('requires a footprint name and a place for each stop', (tester) async {
      useTallWindow(tester);
      var calls = 0;
      ApiService.client = MockClient((_) async {
        calls++;
        return jsonResponse({}, status: 201);
      });

      await tester.pumpWidget(themed(const CreateFootprintScreen()));
      await tester.tap(find.text('儲存足跡'));
      await tester.pump();

      expect(find.text('請輸入足跡名稱'), findsOneWidget);
      expect(find.text('請輸入地點名稱或地址'), findsOneWidget);
      expect(find.textContaining('緯度'), findsNothing);
      expect(find.textContaining('經度'), findsNothing);
      expect(calls, 0);
    });

    testWidgets('saves ordered stops by name, with coordinates only when located', (tester) async {
      useTallWindow(tester);
      Map<String, dynamic>? sent;
      ApiService.client = MockClient((request) async {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return jsonResponse({}, status: 201);
      });

      await tester.pumpWidget(
        themed(
          CreateFootprintScreen(
            locate: () async => (latitude: 22.61, longitude: 120.27),
          ),
        ),
      );
      await tester.enterText(find.widgetWithText(TextFormField, '例如：旗津一日散步'), ' 旗津 ');
      await tester.enterText(find.widgetWithText(TextFormField, '記下這裡的故事…'), '海風');

      await tester.tap(find.text('使用目前位置').first);
      await tester.pumpAndSettle();
      expect(find.text('目前位置'), findsOneWidget);
      expect(find.text('已定位，修改名稱後會改用名稱搜尋地點。'), findsOneWidget);

      await tester.tap(find.text('新增途經點'));
      await tester.pump();
      await tester.enterText(find.widgetWithText(TextFormField, stopHint).last, '旗津海岸公園');
      await tester.tap(find.text('公開'));
      await tester.pump();
      await tester.tap(find.text('儲存足跡'));
      await tester.pumpAndSettle();

      expect(sent, {
        'name': '旗津',
        'note': '海風',
        'privacy': 'public',
        'points': [
          {'lat': 22.61, 'lng': 120.27, 'name': '目前位置', 'order': 1},
          {'name': '旗津海岸公園', 'order': 2},
        ],
      });
    });

    testWidgets('renaming a located stop goes back to searching by name', (tester) async {
      useTallWindow(tester);
      Map<String, dynamic>? sent;
      ApiService.client = MockClient((request) async {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return jsonResponse({}, status: 201);
      });

      await tester.pumpWidget(
        themed(
          CreateFootprintScreen(
            locate: () async => (latitude: 22.61, longitude: 120.27),
          ),
        ),
      );
      await tester.enterText(find.widgetWithText(TextFormField, '例如：旗津一日散步'), '旗津');
      await tester.tap(find.text('使用目前位置'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField, '目前位置'), '駁二藝術特區');
      await tester.pump();

      expect(find.text('已定位，修改名稱後會改用名稱搜尋地點。'), findsNothing);
      await tester.tap(find.text('儲存足跡'));
      await tester.pumpAndSettle();

      expect(sent!['points'], [
        {'name': '駁二藝術特區', 'order': 1},
      ]);
    });

    testWidgets('removing a stop keeps the others and their text', (tester) async {
      useTallWindow(tester);
      await tester.pumpWidget(themed(const CreateFootprintScreen()));

      expect(find.byTooltip('移除第 1 站'), findsNothing);
      await tester.tap(find.text('新增途經點'));
      await tester.pump();
      await tester.enterText(find.widgetWithText(TextFormField, stopHint).last, '留下來');
      await tester.tap(find.byTooltip('移除第 1 站'));
      await tester.pump();

      expect(find.text('第 2 站'), findsNothing);
      expect(find.text('留下來'), findsOneWidget);
    });

    testWidgets('a location failure shows its reason', (tester) async {
      useTallWindow(tester);
      await tester.pumpWidget(
        themed(
          CreateFootprintScreen(
            locate: () async => throw const LocationException('請先開啟裝置的定位服務'),
          ),
        ),
      );

      await tester.tap(find.text('使用目前位置'));
      await tester.pump();
      await tester.pump();

      expect(find.text('請先開啟裝置的定位服務'), findsOneWidget);
      expect(find.text('使用目前位置'), findsOneWidget);
    });

    testWidgets('fits a small phone without overflow', (tester) async {
      await useSmallPhone(tester);

      await tester.pumpWidget(themed(const CreateFootprintScreen()));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.text('誰可以看'),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });

    testWidgets('home reloads after a footprint is created', (tester) async {
      var mapPointLoads = 0;
      final home = backendHandler();
      ApiService.client = MockClient((request) async {
        if (request.url.path.endsWith('/map-points')) {
          if (request.method == 'POST') return jsonResponse({}, status: 201);
          mapPointLoads++;
        }
        return home(request);
      });
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final semantics = tester.ensureSemantics();

      await tester.pumpWidget(themed(const HomeScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('足跡'));
      await tester.pumpAndSettle();
      final addButton = find.byIcon(Icons.add);
      expect(
        tester.getSemantics(addButton),
        isSemantics(label: '新增足跡', isButton: true, hasTapAction: true),
      );
      await tester.tap(addButton);
      await tester.pumpAndSettle();
      expect(find.byType(CreateFootprintScreen), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextFormField, '例如：旗津一日散步'), '旗津');
      await tester.enterText(find.widgetWithText(TextFormField, stopHint), '渡輪站');
      final loadsBefore = mapPointLoads;
      await tester.tap(find.text('儲存足跡'));
      await tester.pumpAndSettle();

      expect(find.byType(CreateFootprintScreen), findsNothing);
      expect(mapPointLoads, loadsBefore + 1);
      semantics.dispose();
    });
  });

  group('HomeScreen', () {
    testWidgets('a footprint found by name can be opened in Google Maps', (tester) async {
      ApiService.client = MockClient(
        backendHandler(
          points: [
            {
              'id': 1,
              'name': '文字路線',
              'created_at': '2026-11-02 00:00:00',
              'latitude': null,
              'longitude': null,
              'points': [
                {'name': '駁二藝術特區', 'lat': null, 'lng': null, 'order': 1},
              ],
            },
            {'id': 2, 'name': '沒有地點', 'created_at': '2026-11-02 00:00:00'},
          ],
        ),
      );
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(themed(const HomeScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('足跡'));
      await tester.pumpAndSettle();

      expect(find.text('文字路線'), findsOneWidget);
      expect(find.text('在 Google 地圖查看'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('long content does not overflow on a small phone', (tester) async {
      await useSmallPhone(tester);
      final long = '很長的文字' * 40;
      ApiService.client = backend(
        entries: [
          {
            'id': 1,
            'title': long,
            'content': long,
            'mood': long,
            'location': long,
            'privacy': 'private',
            'tags': List.filled(12, '很長的標籤文字').join(','),
            'created_at': '短',
          },
        ],
        points: [
          {'id': 1, 'name': long, 'note': long, 'latitude': 22.6, 'longitude': 120.3},
          {'id': 2, 'name': '旗津', 'latitude': 22.7, 'longitude': 120.2},
        ],
      );

      await tester.pumpWidget(themed(const HomeScreen()));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('時間未知'), findsOneWidget);

      for (final tab in ['足跡', '我的']) {
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('malformed data shows an error instead of loading forever', (tester) async {
      ApiService.client = MockClient((_) async => jsonResponse({'unexpected': true}));

      await tester.pumpWidget(themed(const HomeScreen()));
      await tester.pumpAndSettle();

      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('重試'), findsOneWidget);
    });

    testWidgets('shows the empty state with no data', (tester) async {
      ApiService.client = backend();

      await tester.pumpWidget(themed(const HomeScreen()));
      await tester.pumpAndSettle();

      expect(find.textContaining('還沒有日記'), findsOneWidget);
    });

    testWidgets('a failed load shows an error and retry recovers', (tester) async {
      ApiService.client = MockClient((_) async {
        throw http.ClientException('offline');
      });

      await tester.pumpWidget(themed(const HomeScreen()));
      await tester.pumpAndSettle();
      expect(find.textContaining('無法連線'), findsOneWidget);

      ApiService.client = backend();
      await tester.tap(find.text('重試'));
      await tester.pumpAndSettle();

      expect(find.textContaining('無法連線'), findsNothing);
      expect(find.text('近期時間軸'), findsOneWidget);
    });
  });

  group('CreateEntryScreen', () {
    testWidgets('sends a privacy value the backend accepts', (tester) async {
      tester.view.physicalSize = const Size(800, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      Map<String, dynamic>? sent;
      ApiService.client = MockClient((request) async {
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return jsonResponse({}, status: 201);
      });

      await tester.pumpWidget(themed(const CreateEntryScreen()));
      await tester.enterText(find.byType(TextFormField).at(0), ' 標題 ');
      await tester.enterText(find.byType(TextFormField).at(1), '內容');
      await tester.enterText(find.byType(TextFormField).at(3), '星空, 散步,');
      await tester.tap(find.text('摯友'));
      await tester.pump();
      await tester.tap(find.text('儲存日記'));
      await tester.pumpAndSettle();

      expect(sent, {
        'title': '標題',
        'content': '內容',
        'mood': '開心',
        'location': null,
        'privacy': 'friends',
        'tags': '星空,散步',
      });
    });

    testWidgets('does not submit an empty form', (tester) async {
      var calls = 0;
      ApiService.client = MockClient((_) async {
        calls++;
        return jsonResponse({}, status: 201);
      });

      await tester.pumpWidget(themed(const CreateEntryScreen()));
      await tester.tap(find.text('儲存日記'));
      await tester.pump();

      expect(find.text('請輸入日記標題'), findsOneWidget);
      expect(calls, 0);
    });

    testWidgets('fits a small phone without overflow', (tester) async {
      await useSmallPhone(tester);
      ApiService.client = backend();

      await tester.pumpWidget(themed(const CreateEntryScreen()));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.text('誰可以看'),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
