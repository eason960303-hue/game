import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:life_logger/services/api_service.dart';

http.Response jsonResponse(
  Object body, {
  int status = 200,
  Map<String, String> headers = const {},
}) {
  return http.Response.bytes(
    utf8.encode(jsonEncode(body)),
    status,
    headers: {'content-type': 'application/json', ...headers},
  );
}

const _user = {'id': 1, 'email': 'a@example.com', 'display_name': '小明'};
const _sessionCookie =
    'life_logger_session=abc123; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    ApiService.client = MockClient((_) async => jsonResponse({}));
    await ApiService.logout();
  });

  Future<void> signIn() async {
    ApiService.client = MockClient((_) async {
      return jsonResponse(
        {'authenticated': true, 'user': _user},
        headers: {'set-cookie': _sessionCookie},
      );
    });
    await ApiService.login(email: 'a@example.com', password: 'password1');
  }

  test('login stores the session and sends it on later requests', () async {
    await signIn();
    expect(ApiService.currentUser.value?.displayName, '小明');

    String? sentCookie;
    ApiService.client = MockClient((request) async {
      sentCookie = request.headers['Cookie'];
      return jsonResponse([]);
    });
    await ApiService.fetchEntries();

    expect(sentCookie, 'life_logger_session=abc123');
    expect(
      await const FlutterSecureStorage().read(key: 'session_token'),
      'abc123',
    );
  });

  test('restoreSession signs in with a stored token', () async {
    FlutterSecureStorage.setMockInitialValues({'session_token': 'stored'});
    String? sentCookie;
    ApiService.client = MockClient((request) async {
      sentCookie = request.headers['Cookie'];
      return jsonResponse({'authenticated': true, 'user': _user});
    });

    await ApiService.restoreSession();

    expect(sentCookie, 'life_logger_session=stored');
    expect(ApiService.currentUser.value?.id, 1);
  });

  test('restoreSession keeps the token when the server is unreachable', () async {
    FlutterSecureStorage.setMockInitialValues({'session_token': 'stored'});
    ApiService.client = MockClient((_) async {
      throw http.ClientException('offline');
    });

    await expectLater(ApiService.restoreSession(), throwsA(isA<ApiException>()));

    expect(
      await const FlutterSecureStorage().read(key: 'session_token'),
      'stored',
    );
  });

  test('an expired session signs the user out', () async {
    await signIn();
    ApiService.client = MockClient((_) async {
      return jsonResponse({'detail': '登入已失效，請重新登入'}, status: 401);
    });

    await expectLater(
      ApiService.fetchEntries(),
      throwsA(
        isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401),
      ),
    );

    expect(ApiService.currentUser.value, isNull);
    expect(await const FlutterSecureStorage().read(key: 'session_token'), isNull);
  });

  test('a rejected login shows the server message and clears nothing', () async {
    ApiService.client = MockClient((_) async {
      return jsonResponse({'detail': '電子郵件或密碼不正確'}, status: 401);
    });

    await expectLater(
      ApiService.login(email: 'a@example.com', password: 'wrong'),
      throwsA(
        isA<ApiException>().having((e) => e.message, 'message', '電子郵件或密碼不正確'),
      ),
    );
  });

  test('validation errors surface the first message', () async {
    ApiService.client = MockClient((_) async {
      return jsonResponse({
        'detail': [
          {'loc': ['body', 'title'], 'msg': 'String too long'},
        ],
      }, status: 422);
    });

    await expectLater(
      ApiService.createEntry({}),
      throwsA(
        isA<ApiException>().having((e) => e.message, 'message', 'String too long'),
      ),
    );
  });

  test('network failures become a readable error', () async {
    ApiService.client = MockClient((_) async {
      throw http.ClientException('connection refused');
    });

    await expectLater(
      ApiService.fetchEntries(),
      throwsA(
        isA<ApiException>().having((e) => e.message, 'message', contains('無法連線')),
      ),
    );
  });

  test('responses without a charset are decoded as UTF-8', () async {
    ApiService.client = MockClient((_) async {
      return jsonResponse([
        {'title': '繁體中文'},
      ]);
    });

    final entries = await ApiService.fetchEntries();

    expect(entries.single['title'], '繁體中文');
  });
}
